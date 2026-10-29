import type {
  PlatformConfig,
  DraftItem,
  StatItem,
  PostItem,
  ConnectedAccount,
  Brand,
  Session,
} from "@/lib/api/types";

export const SEED_PLATFORMS: PlatformConfig[] = [
  {
    id: "ig",
    k: "IG",
    bg: "#D62976",
    name: "Instagram",
    sub: "@novastudio.co",
    limit: 2200,
  },
  {
    id: "li",
    k: "in",
    bg: "#0A66C2",
    name: "LinkedIn",
    sub: "Nova Studio",
    limit: 3000,
  },
  {
    id: "tt",
    k: "TT",
    bg: "#111111",
    name: "TikTok",
    sub: "Reconnect first",
    limit: 2200,
    warn: true,
  },
  {
    id: "fb",
    k: "f",
    bg: "#1877F2",
    name: "Facebook",
    sub: "Not connected",
    limit: 63206,
    off: true,
  },
];

export const SEED_ACCOUNTS: ConnectedAccount[] = [
  {
    id: "acc-ig",
    platform: "ig",
    badge: "IG",
    badgeBg: "#D62976",
    handle: "@novastudio.co",
    status: "connected",
  },
  {
    id: "acc-li",
    platform: "li",
    badge: "in",
    badgeBg: "#0A66C2",
    handle: "Nova Studio",
    status: "connected",
  },
  {
    id: "acc-tt",
    platform: "tt",
    badge: "TT",
    badgeBg: "#111111",
    handle: "@novastudio",
    status: "needs_attention",
  },
];

export const SEED_STATS: StatItem[] = [
  {
    label: "Engagements",
    value: "134.5k",
    delta: "8.2%",
    deltaColor: "#0B7A3B",
    isUp: true,
    spark: "2,20 12,17 22,18 32,12 42,13 52,8 62,9 70,4",
    sparkColor: "#12A150",
  },
  {
    label: "New followers",
    value: "+134",
    delta: "2.1%",
    deltaColor: "#0B7A3B",
    isUp: true,
    spark: "2,16 12,15 22,17 32,14 42,12 52,13 62,10 70,9",
    sparkColor: "#12A150",
  },
  {
    label: "Link clicks",
    value: "1.9k",
    delta: "3.4%",
    deltaColor: "#B42318",
    isUp: false,
    spark: "2,6 12,8 22,7 32,11 42,10 52,14 62,13 70,16",
    sparkColor: "#9AA39C",
  },
  {
    label: "Comments",
    value: "130",
    delta: "12%",
    deltaColor: "#0B7A3B",
    isUp: true,
    spark: "2,19 12,18 22,14 32,15 42,10 52,11 62,6 70,5",
    sparkColor: "#12A150",
  },
];

export const SEED_DRAFTS: DraftItem[] = [
  {
    id: "draft-1",
    title: "Halloween shade picks",
    body: "Three shades, three moods. Which one are you wearing on the 31st? Tell us in the comments and we’ll pick a winner for a free gloss.",
    state: "Ready",
    pfs: [
      { k: "IG", bg: "#D62976" },
      { k: "TT", bg: "#111111" },
    ],
    edited: "Edited 2 hours ago",
    action: "Schedule",
  },
  {
    id: "draft-2",
    title: "Thank you, first 100 customers",
    body: "A hundred orders ago this was a table in a hostel room. Every one of you made this real. Here’s what we’re doing to say thanks.",
    state: "Needs a photo",
    pfs: [
      { k: "IG", bg: "#D62976" },
      { k: "in", bg: "#0A66C2" },
    ],
    edited: "Edited yesterday",
    action: "Add photo",
  },
  {
    id: "draft-3",
    title: "How we choose our packaging",
    body: "Idea: walk through the three packaging suppliers we tried and why we picked the one we did.",
    state: "Idea",
    pfs: [{ k: "TT", bg: "#111111" }],
    edited: "Saved 3 days ago",
    action: "Write it",
  },
  {
    id: "draft-4",
    title: "Lip care routine, 3 steps",
    body: "Scrub, balm, gloss. Thirty seconds a night is all it takes. Save this for later.",
    state: "Ready",
    pfs: [{ k: "IG", bg: "#D62976" }],
    edited: "Edited 4 days ago",
    action: "Schedule",
  },
  {
    id: "draft-5",
    title: "Meet the team: who packs your order",
    body: "Short intro to the two people who wrap, seal and write the note on every box.",
    state: "Needs a photo",
    pfs: [
      { k: "IG", bg: "#D62976" },
      { k: "in", bg: "#0A66C2" },
    ],
    edited: "Edited last week",
    action: "Add photo",
  },
  {
    id: "draft-6",
    title: "Customer question of the week",
    body: "Idea: answer the most common DM each week as a post.",
    state: "Idea",
    pfs: [
      { k: "IG", bg: "#D62976" },
      { k: "TT", bg: "#111111" },
    ],
    edited: "Saved last week",
    action: "Write it",
  },
];

export const SEED_POSTS: PostItem[] = [
  {
    id: "post-1",
    title: "Weekend drop prep",
    caption:
      "Weekend drop prep is in full swing. Every order is packed by hand, wrapped in tissue and sealed with a note from the team, because opening it should feel as good as what's inside.\n\nThe new lip gloss collection goes live Friday at 7 PM. Turn on post notifications so you don't miss your shade.",
    hashtags: [
      "#smallbusiness",
      "#packingorders",
      "#lipgloss",
      "#shoplocal",
    ],
    aspectRatio: "1 / 1",
    time: "7:00 PM",
    dateStr: "Fri, 30 Oct 2026",
    scheduledFor: "Posts Fri 30 Oct at 7:00 PM · in 5 days",
    state: "scheduled",
    platforms: ["ig", "li"],
    activityLog: [
      {
        text: "Scheduled for Fri 30 Oct, 7:00 PM",
        time: "Sun 4:12 PM",
        dot: "#12A150",
      },
      {
        text: "Caption edited by Mary",
        time: "Sun 4:10 PM",
        dot: "#9AA39C",
      },
      {
        text: "Written by Brandbuild from your idea",
        time: "Sun 4:08 PM",
        dot: "#9AA39C",
      },
    ],
    metrics: {
      reach: "3.1k",
      likes: "412",
      comments: "38",
      saves: "96",
      note: "Saves are well above your usual. Packing posts are working.",
    },
    reviewer: {
      name: "Mary",
      initial: "M",
      note: "Tobi sent this yesterday. It goes out Fri 7:00 PM once approved. If it isn't approved by then, it waits and nobody is notified twice.",
    },
    failureInfo: {
      title: "Didn't post to Instagram",
      message:
        "Instagram doesn't accept images wider than 1.91:1. This one is 2.4:1. LinkedIn posted fine.",
    },
    checkingInfo: {
      title: "Checking whether Instagram posted this",
      message:
        "Instagram didn't confirm in time. Please don't post it again yourself, or it may appear twice. We'll confirm within [X MINUTES] and tell you either way.",
    },
    pausedInfo: {
      title: "Publishing is paused for this workspace",
      message:
        "[REASON, e.g. a payment problem or a request from the account owner]. This post is held and will go out when publishing resumes, unless its time has passed.",
    },
  },
  {
    id: "post-2",
    title: "Lip gloss collection — shade lineup",
    caption:
      "From warm nude to glassy berry, here are all 6 shades dropping this Friday.\n\nFormulated with jojoba and shea butter for non-sticky all-day hydration.",
    hashtags: ["#lipgloss", "#swatches", "#cleanbeauty"],
    aspectRatio: "1 / 1",
    time: "12:30 PM",
    dateStr: "Wed, 28 Oct 2026",
    scheduledFor: "Posts Wed 28 Oct at 12:30 PM",
    state: "scheduled",
    platforms: ["ig", "li"],
    activityLog: [
      {
        text: "Scheduled for Wed 28 Oct, 12:30 PM",
        time: "Sat 11:20 AM",
        dot: "#12A150",
      },
    ],
  },
  {
    id: "post-3",
    title: "Customer shout-out: Adaeze’s unboxing",
    caption:
      "When @adaeze filmed her unboxing, our whole team stopped to watch. Thank you for showing love to the little details!",
    hashtags: ["#unboxing", "#customerlove"],
    aspectRatio: "1 / 1",
    time: "6:00 PM",
    dateStr: "Thu, 29 Oct 2026",
    scheduledFor: "Awaiting approval for Thu 29 Oct, 6:00 PM",
    state: "approval",
    platforms: ["ig"],
    activityLog: [
      {
        text: "Sent for approval by Tobi",
        time: "Sat 3:40 PM",
        dot: "#2E6FB5",
      },
      {
        text: "Written by Brandbuild from Tobi’s idea",
        time: "Sat 3:31 PM",
        dot: "#9AA39C",
      },
    ],
    reviewer: {
      name: "Mary",
      initial: "M",
      note: "Tobi submitted this shout-out draft. Awaiting review.",
    },
  },
  {
    id: "post-4",
    title: "Drop is live — link in bio",
    caption:
      "The wait is over! Our entire lip care range is live on novastudio.co right now. Free shipping on all orders this weekend.",
    hashtags: ["#droplive", "#smallbiz", "#shopnow"],
    aspectRatio: "1 / 1",
    time: "7:00 PM",
    dateStr: "Fri, 30 Oct 2026",
    scheduledFor: "Posts Fri 30 Oct at 7:00 PM",
    state: "scheduled",
    platforms: ["ig", "li", "tt"],
    activityLog: [
      {
        text: "Scheduled for Fri 30 Oct, 7:00 PM",
        time: "Sun 10:15 AM",
        dot: "#12A150",
      },
    ],
  },
  {
    id: "post-5",
    title: "Behind the counter",
    caption:
      "A quick morning view before the orders start pouring in. Good coffee and lots of bubble wrap.",
    hashtags: ["#bts", "#studio"],
    aspectRatio: "1 / 1",
    time: "7:00 PM",
    dateStr: "Fri, 2 Oct 2026",
    scheduledFor: "Posted Fri 2 Oct at 7:00 PM",
    state: "published",
    platforms: ["ig"],
    activityLog: [
      {
        text: "Published to Instagram",
        time: "Fri 7:00 PM",
        dot: "#12A150",
      },
    ],
    metrics: {
      reach: "2.8k",
      likes: "340",
      comments: "24",
      saves: "78",
    },
  },
  // One post in each remaining state, so every PostDetail state is reachable.
  {
    id: "post-6",
    title: "Gloss close-ups",
    caption: "Up close, every shade has a little shimmer. Which one is yours?",
    hashtags: ["#lipgloss", "#swatches"],
    aspectRatio: "2.4 / 1",
    time: "7:00 PM",
    dateStr: "Tue, 27 Oct 2026",
    scheduledFor: "Tue 27 Oct at 7:00 PM · 1 of 2 platforms posted",
    state: "failed",
    platforms: ["ig", "li"],
    activityLog: [
      { text: "Instagram rejected the image", time: "Tue 7:00 PM", dot: "#D92D20" },
      { text: "Published to LinkedIn", time: "Tue 7:00 PM", dot: "#12A150" },
    ],
    failureInfo: {
      title: "Didn't post to Instagram",
      message: "Instagram doesn't accept images wider than 1.91:1. This one is 2.4:1. LinkedIn posted fine.",
    },
  },
  {
    id: "post-7",
    title: "Restock alert",
    caption: "Our best-seller is back in stock. Thank you for waiting.",
    hashtags: ["#restock"],
    aspectRatio: "1 / 1",
    time: "12:00 PM",
    dateStr: "Mon, 26 Oct 2026",
    scheduledFor: "Mon 26 Oct at 12:00 PM · confirming with Instagram",
    state: "checking",
    platforms: ["ig", "li"],
    activityLog: [
      { text: "Instagram didn’t confirm. We’re checking", time: "Mon 12:02 PM", dot: "#B26A00" },
      { text: "Published to LinkedIn", time: "Mon 12:00 PM", dot: "#12A150" },
    ],
    checkingInfo: {
      title: "Checking whether Instagram posted this",
      message:
        "Instagram didn't confirm in time. Please don't post it again yourself, or it may appear twice. We'll confirm within [X MINUTES] and tell you either way.",
    },
  },
  {
    id: "post-8",
    title: "Weekend opening hours",
    caption: "We're open Saturday 10 AM to 4 PM for pickups.",
    hashtags: ["#shoplocal"],
    aspectRatio: "1 / 1",
    time: "9:00 AM",
    dateStr: "Sat, 31 Oct 2026",
    scheduledFor: "Was due Sat 31 Oct at 9:00 AM",
    state: "paused",
    platforms: ["ig"],
    activityLog: [{ text: "Held: publishing paused for this workspace", time: "Fri 6:00 PM", dot: "#0F2A1B" }],
    pausedInfo: {
      title: "Publishing is paused for this workspace",
      message:
        "[REASON, e.g. a payment problem or a request from the account owner]. This post is held and will go out when publishing resumes, unless its time has passed.",
    },
  },
  // Published history for the calendar (titles from the Calendar design).
  ...([
    ["post-h1", "Founder note: year one", "Tue, 6 Oct 2026", "9:00 AM", ["li"]],
    ["post-h2", "Shade swatches", "Fri, 9 Oct 2026", "7:00 PM", ["ig"]],
    ["post-h3", "Packing, start to finish", "Tue, 13 Oct 2026", "6:00 PM", ["ig", "tt"]],
    ["post-h4", "We’re hiring a packer", "Fri, 16 Oct 2026", "12:30 PM", ["li"]],
    ["post-h5", "Your reviews, read aloud", "Tue, 20 Oct 2026", "7:00 PM", ["ig", "tt"]],
    ["post-h6", "Weekend teaser", "Fri, 23 Oct 2026", "7:00 PM", ["ig"]],
  ] as const).map(
    ([id, title, dateStr, time, platforms]): PostItem => ({
      id,
      title,
      caption: `${title}. Sample caption from the design's calendar.`,
      hashtags: ["#smallbusiness"],
      aspectRatio: "1 / 1",
      time,
      dateStr,
      scheduledFor: `Posted ${dateStr.replace(",", "").replace(/ \d{4}$/, "")} at ${time}`,
      state: "published",
      platforms: [...platforms],
      activityLog: [{ text: "Published", time: `${dateStr.slice(0, 3)} ${time}`, dot: "#12A150" }],
      metrics: { reach: "1.2k", likes: "150", comments: "12", saves: "30" },
    }),
  ),
];

export const SEED_BRAND: Brand = {
  id: "brand-nova",
  name: "Nova Studio",
  voice: "warm, confident",
  plan: "student",
  planEndsLabel: "[END DATE]",
};

export const SEED_SESSION: Session = {
  userId: "user-mary",
  name: "Mary",
  identifier: "mary@novastudio.co",
  role: "owner",
};
