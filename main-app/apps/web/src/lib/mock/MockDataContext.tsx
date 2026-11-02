"use client";

import React, { createContext, useContext, useEffect, useState, useTransition } from "react";
import type {
  PostItem,
  DraftItem,
  ConnectedAccount,
  StatItem,
  PlatformConfig,
  PostState,
} from "./types";
import {
  SEED_POSTS,
  SEED_DRAFTS,
  SEED_ACCOUNTS,
  SEED_STATS,
  SEED_PLATFORMS,
} from "./seed-data";

interface MockDataContextType {
  posts: PostItem[];
  drafts: DraftItem[];
  accounts: ConnectedAccount[];
  stats: StatItem[];
  platforms: PlatformConfig[];
  activeRole: "owner" | "editor";
  setActiveRole: (role: "owner" | "editor") => void;
  getPost: (id: string) => PostItem | undefined;
  updatePostState: (id: string, newState: PostState) => void;
  addPost: (post: Omit<PostItem, "id">) => PostItem;
  deletePost: (id: string) => void;
  addDraft: (draft: Omit<DraftItem, "id">) => DraftItem;
  deleteDraft: (id: string) => void;
  resetToDefaults: () => void;
}

const MockDataContext = createContext<MockDataContextType | null>(null);

const STORAGE_KEY = "brandbuild_mock_data_v1";

export function MockDataProvider({ children }: { children: React.ReactNode }) {
  const [, startTransition] = useTransition();
  const [posts, setPosts] = useState<PostItem[]>(SEED_POSTS);
  const [drafts, setDrafts] = useState<DraftItem[]>(SEED_DRAFTS);
  const [accounts] = useState<ConnectedAccount[]>(SEED_ACCOUNTS);
  const [stats] = useState<StatItem[]>(SEED_STATS);
  const [platforms] = useState<PlatformConfig[]>(SEED_PLATFORMS);
  const [activeRole, setActiveRole] = useState<"owner" | "editor">("owner");

  // Load from localStorage on client mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Hydrate after mount so server and first client render match.
        /* eslint-disable react-hooks/set-state-in-effect */
        if (parsed.posts) setPosts(parsed.posts);
        if (parsed.drafts) setDrafts(parsed.drafts);
        if (parsed.activeRole) setActiveRole(parsed.activeRole);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Sync to localStorage
  const persist = (nextPosts: PostItem[], nextDrafts: DraftItem[], nextRole: "owner" | "editor") => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ posts: nextPosts, drafts: nextDrafts, activeRole: nextRole })
      );
    } catch {
      // Ignore
    }
  };

  const getPost = (id: string) => {
    return posts.find((p) => p.id === id);
  };

  const updatePostState = (id: string, newState: PostState) => {
    startTransition(() => {
      setPosts((prev) => {
        const next = prev.map((p) => (p.id === id ? { ...p, state: newState } : p));
        persist(next, drafts, activeRole);
        return next;
      });
    });
  };

  const addPost = (item: Omit<PostItem, "id">) => {
    const id = `post-${Date.now()}`;
    const newPost: PostItem = { ...item, id };
    startTransition(() => {
      setPosts((prev) => {
        const next = [newPost, ...prev];
        persist(next, drafts, activeRole);
        return next;
      });
    });
    return newPost;
  };

  const deletePost = (id: string) => {
    startTransition(() => {
      setPosts((prev) => {
        const next = prev.filter((p) => p.id !== id);
        persist(next, drafts, activeRole);
        return next;
      });
    });
  };

  const addDraft = (item: Omit<DraftItem, "id">) => {
    const id = `draft-${Date.now()}`;
    const newDraft: DraftItem = { ...item, id };
    startTransition(() => {
      setDrafts((prev) => {
        const next = [newDraft, ...prev];
        persist(posts, next, activeRole);
        return next;
      });
    });
    return newDraft;
  };

  const deleteDraft = (id: string) => {
    startTransition(() => {
      setDrafts((prev) => {
        const next = prev.filter((d) => d.id !== id);
        persist(posts, next, activeRole);
        return next;
      });
    });
  };

  const handleRoleChange = (role: "owner" | "editor") => {
    setActiveRole(role);
    persist(posts, drafts, role);
  };

  const resetToDefaults = () => {
    setPosts(SEED_POSTS);
    setDrafts(SEED_DRAFTS);
    setActiveRole("owner");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  return (
    <MockDataContext.Provider
      value={{
        posts,
        drafts,
        accounts,
        stats,
        platforms,
        activeRole,
        setActiveRole: handleRoleChange,
        getPost,
        updatePostState,
        addPost,
        deletePost,
        addDraft,
        deleteDraft,
        resetToDefaults,
      }}
    >
      {children}
    </MockDataContext.Provider>
  );
}

export function useMockData() {
  const context = useContext(MockDataContext);
  if (!context) {
    throw new Error("useMockData must be used within a MockDataProvider");
  }
  return context;
}
