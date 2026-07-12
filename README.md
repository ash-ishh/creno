# Cerno

> **Protect your attention by learning what “high signal” means to you.**

Cerno is a personal intelligence system that reads, watches, and listens on your behalf. It learns your durable taste, understands what you are working on right now, and surfaces only the claims, resources, and exact moments worth your attention.

Most tools help you consume faster. Cerno decides what deserves to be consumed at all.

The name comes from the Latin *cernere*: to sift, distinguish, and decide.

## Why Cerno

The internet does not have an information shortage. It has a judgment problem.

High-signal ideas are scattered across papers, newsletters, videos, podcasts, feeds, and archives. Finding them requires consuming an unreasonable amount of material, while most existing products solve the wrong part of the problem:

- Recommendation feeds optimize for engagement, not your goals.
- Read-later tools collect content but do not consume it for you.
- Generic summaries make content shorter without deciding whether it is worth your time.
- Search treats every query as new and ignores what you already know.

Cerno acts as a filter with memory. It learns your quality bar, follows your active areas of focus, removes repetition, and builds a personal index of material that has already been read and evaluated for you.

## How it works

### 1. Define what matters now

Create a **Focus Thread** for a project, question, or decision you are actively working on.

Examples:

- Track production use cases for long-term agent memory.
- Understand recent advances in video reasoning.
- Find distribution ideas relevant to an AI infrastructure company.
- Prepare for a conversation with an investor or domain expert.

Focus Threads are explicit, temporary, and editable. They are kept separate from your long-term interests so a short-term project does not permanently distort your profile.

### 2. Teach Cerno your taste

Cerno maintains a legible, versioned **TasteDoc** describing:

- Subjects you care about
- Your existing level of expertise
- People and sources you trust
- Formats and styles you prefer
- Evidence and quality standards
- Topics, arguments, and patterns you find repetitive
- Characteristics that make something high signal for you

The TasteDoc is a document you can inspect and edit—not a hidden behavioral profile. Cerno can propose changes from your feedback, but you remain in control of what becomes part of it.

### 3. Scout broadly, consume selectively

Cerno monitors connected sources and discovers candidates related to your Focus Threads. It first performs inexpensive triage, then deeply processes only the promising material.

Depending on the source, it can:

- Read an article, newsletter, or paper
- Watch and analyze a long video
- Listen to a podcast or interview
- Extract claims, evidence, topics, and entities
- Identify the exact passage or timestamp that matters
- Compare the material with information already in your personal index

The objective is not to summarize everything. It is to decide what deserves deeper consumption and what deserves your attention afterward.

### 4. Receive a finite briefing

Cerno produces a concise briefing organized around your active work rather than an infinite feed.

A **Focus Thread is context, not a feed**. Each bounded Research Run publishes one canonical briefing, while the **Briefing Desk** collects those documents across threads. Cerno does not manufacture a daily brief merely because another day has passed.

A briefing can include:

- **Must know now** — a new development directly relevant to your focus
- **Exact moment** — the few minutes worth watching in a long video or podcast
- **From your archive** — an older resource that has become relevant again
- **Serendipity** — a credible adjacent idea outside your normal information graph
- **Rejected as noise** — duplicate, introductory, weakly supported, or irrelevant material

Every selection explains:

- Why it is relevant to you
- Why it matters now
- What is genuinely new
- What evidence supports it
- How it relates to something you already know
- How much time it deserves

### 5. Correct the reasoning

Simple likes and dislikes are ambiguous. Cerno lets you correct *why* an item was selected:

- Right author, wrong topic
- Relevant, but not right now
- Too introductory for me
- I already know this argument
- Strong idea, weak evidence
- This changed how I think about the problem

Feedback becomes a structured event. Cerno uses accumulated feedback to propose a visible TasteDoc change, which you can approve or reject. This improves future judgment without turning your profile into an opaque model.

## Personal intelligence agency

Cerno operates like a personal research and briefing team rather than a monolithic assistant. A **Research Director** understands each Focus Thread, plans the work, delegates it to specialist agents, reviews their findings, and produces the final briefing.

- **Research Director** — plans the research, delegates tasks, reviews evidence, and decides when work is ready
- **Scout** — discovers promising material using connected sources and the personal archive
- **Analyst** — deeply reads or watches selected material and extracts claims, evidence, and relevant moments
- **Personal Editor** — evaluates novelty, relevance, redundancy, and fit with the TasteDoc
- **Taste Editor** — turns user feedback into reviewed changes to the taste profile

The agents share the current mission, relevant personal history, editorial preferences, and prior findings across handoffs. The Research Director can request revisions when evidence is weak and escalate uncertainty instead of presenting it as fact.

Deterministic components handle source ingestion, storage, retrieval, and other predictable operations. Agents are used where planning, interpretation, and judgment are required.

Together, this team performs the personal research-and-briefing function: understanding what matters, monitoring relevant information, consuming it, judging its value, and delivering decision-ready intelligence.

## The personal index

Everything Cerno processes contributes to memory, but accepted and rejected material remain distinct:

- The **processed corpus** records what was examined and why it was accepted or rejected.
- The **personal index** contains pre-vetted claims, moments, and resources worth retrieving later.

This allows Cerno to answer questions such as:

- What are the best resources I have encountered on agent memory?
- Have I effectively seen this argument before?
- What changed since I last researched this subject?
- Which saved paper is relevant to my current project?
- What should I read before this meeting?

The index turns past consumption into reusable context instead of a forgotten pile of bookmarks.

## How Cerno judges signal

“High signal” is personal and contextual. Cerno evaluates each candidate across several independent dimensions:

```text
personal value =
    focus relevance
  + taste fit
  + novelty against personal history
  + evidence quality
  + source trust
  - redundancy
```

The score is not presented as objective truth. Its component reasoning is exposed so the user can challenge and correct it.

Serendipity is handled through a separate exploration budget rather than being mixed invisibly into relevance. This prevents the system from becoming a filter bubble while keeping exploration under user control.

## Product principles

1. **Protect attention, not engagement.** Success means fewer valuable things to consume, not more time spent in the product.
2. **Consume, do not merely aggregate.** Cerno should find the useful claim or moment inside the source.
3. **Keep taste legible.** The user must be able to inspect and change the system’s understanding of them.
4. **Separate durable taste from current focus.** Long-term identity and short-term priorities should not contaminate each other.
5. **Treat redundancy as noise.** Repetition is low value even when the repeated idea is relevant.
6. **Explain every decision.** Recommendations require provenance, evidence, and personalized reasoning.
7. **Make serendipity intentional.** Exploration should be visible and adjustable.
8. **Preserve memory.** Useful research should compound instead of disappearing into a feed.

## System overview

```text
Sources
  │
  ▼
Candidate discovery and triage
  │
  ▼
Deep consumption and distillation
  │
  ├── claims and evidence
  ├── relevant passages or timestamps
  └── topics and entities
  │
  ▼
Personal judgment
  ├── TasteDoc
  ├── active Focus Threads
  ├── novelty against the personal index
  └── source and evidence quality
  │
  ├──────────────► Finite briefing
  └──────────────► Personal index
                         ▲
                         │
                  Reviewed feedback
```

Source integrations are adapters that emit a common content format. Briefings, search, and other experiences are different views over the same evaluated index.

## Initial scope

The first version focuses on proving one complete loop:

1. Create an explicit Focus Thread.
2. Calibrate an editable TasteDoc with high- and low-signal examples.
3. Process articles, papers, and long-form video.
4. Search both live sources and a small historical archive.
5. Deliver a cited, personalized briefing.
6. Correct one selection’s reasoning and review the resulting TasteDoc change.
7. Use the updated profile in the next briefing.

Broader source integrations, automatic history imports, continuous monitoring, conversational search, and additional briefing formats can build on this foundation.

## What Cerno is not

- Not another infinite feed
- Not a generic article or video summarizer
- Not a bookmark manager with embeddings
- Not a black-box recommendation algorithm
- Not an assistant that maximizes engagement
- Not a replacement for checking primary evidence when a decision is consequential

Cerno exists to help you consume less, understand more, and preserve the knowledge that matters.

## Running implementation

The production-path application now lives in [`app/`](app/). It uses Convex as canonical product memory, LinkUp for live discovery and full source fetches, and the restricted Azure-hosted Hermes runtime for Director-led specialist delegation. The verified local flow publishes three claims only after each quote is matched to fetched primary-source text, then turns explicit feedback into a reviewed TasteDoc version. IDs, usage, evidence hashes, and the honesty boundary are recorded in [`docs/LIVE-VERIFICATION.md`](docs/LIVE-VERIFICATION.md).

The earlier [`prototype/`](prototype/) remains a fixture-only design artifact and is not imported by the application.

## Status

The complete single-user workflow runs locally against live services. LinkUp discovers sources, VideoDB resolves one selected long-form video into timestamped transcript evidence and a playable moment, and Hermes delegates review. Public deployment still requires connecting `app/` to a Convex cloud project; authentication remains outside the current cut.
