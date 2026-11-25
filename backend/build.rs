fn main() {
    // sqlx::migrate! embeds the directory at compile time. Adding a migration must
    // rebuild the library as well as changes to migrations already in the list.
    println!("cargo:rerun-if-changed=migrations");
}
