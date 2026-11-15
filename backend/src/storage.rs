//! Where uploaded files live. One interface, two back ends:
//! a local folder (development) and any S3-compatible bucket (production).
use std::{sync::Arc, time::Duration};

use object_store::{
    aws::{AmazonS3, AmazonS3Builder},
    local::LocalFileSystem,
    path::Path,
    signer::Signer,
    ObjectStore, WriteMultipart,
};

/// How long a signed download link stays valid.
const SIGNED_URL_TTL: Duration = Duration::from_secs(300);

#[derive(Clone)]
pub struct Storage {
    store: Arc<dyn ObjectStore>,
    /// Set for S3, where files are handed out as short-lived signed links.
    signer: Option<Arc<AmazonS3>>,
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("storage is not configured correctly: {0}")]
    Config(String),
    #[error(transparent)]
    Store(#[from] object_store::Error),
}

impl Storage {
    /// S3 when S3_BUCKET is set, otherwise the folder in MEDIA_DIR (default `./media`).
    pub fn from_env() -> Result<Self, StorageError> {
        match std::env::var("S3_BUCKET") {
            Ok(bucket) if !bucket.is_empty() => {
                let mut builder = AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .with_region(std::env::var("S3_REGION").unwrap_or_else(|_| "auto".into()));
                if let Ok(endpoint) = std::env::var("S3_ENDPOINT") {
                    builder = builder
                        .with_allow_http(endpoint.starts_with("http://"))
                        .with_endpoint(endpoint);
                }
                if let (Ok(key), Ok(secret)) = (
                    std::env::var("S3_ACCESS_KEY"),
                    std::env::var("S3_SECRET_KEY"),
                ) {
                    builder = builder
                        .with_access_key_id(key)
                        .with_secret_access_key(secret);
                }
                let s3 = Arc::new(builder.build()?);
                Ok(Self {
                    store: s3.clone(),
                    signer: Some(s3),
                })
            }
            _ => Self::local(std::env::var("MEDIA_DIR").unwrap_or_else(|_| "media".into())),
        }
    }

    pub fn local(dir: impl AsRef<std::path::Path>) -> Result<Self, StorageError> {
        std::fs::create_dir_all(dir.as_ref()).map_err(|e| StorageError::Config(e.to_string()))?;
        Ok(Self {
            store: Arc::new(LocalFileSystem::new_with_prefix(dir)?),
            signer: None,
        })
    }

    /// Starts a streamed upload. Call `write` per chunk, then `finish` or `abort`.
    pub async fn begin(&self, key: &str) -> Result<WriteMultipart, StorageError> {
        let upload = self.store.put_multipart(&Path::from(key)).await?;
        Ok(WriteMultipart::new(upload))
    }

    /// The whole file in memory. Only for small files and tests.
    pub async fn read(&self, key: &str) -> Result<bytes::Bytes, StorageError> {
        Ok(self.store.get(&Path::from(key)).await?.bytes().await?)
    }

    /// The file as a stream of chunks.
    pub async fn stream(
        &self,
        key: &str,
    ) -> Result<
        futures_util::stream::BoxStream<'static, object_store::Result<bytes::Bytes>>,
        StorageError,
    > {
        Ok(self.store.get(&Path::from(key)).await?.into_stream())
    }

    /// A short-lived public link, when the back end can make one (S3). Local files have none.
    pub async fn signed_url(&self, key: &str) -> Result<Option<String>, StorageError> {
        match &self.signer {
            Some(s3) => Ok(Some(
                s3.signed_url(http::Method::GET, &Path::from(key), SIGNED_URL_TTL)
                    .await?
                    .to_string(),
            )),
            None => Ok(None),
        }
    }

    pub async fn delete(&self, key: &str) -> Result<(), StorageError> {
        Ok(self.store.delete(&Path::from(key)).await?)
    }
}
