"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { LinkupClient, type TextSearchResult } from "linkup-sdk";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { Id } from "./_generated/dataModel";
import {
  VideoDbClient,
  playerUrl as videoDbPlayerUrl,
  type VideoDbShot,
  type VideoDbTranscriptSegment,
} from "./lib/videoDb";

const HERMES_DEFAULT_URL = "https://cerno-hermes-74d2dc62.eastus.cloudapp.azure.com";

function normalizeCandidateKey(value: unknown) {
  if (typeof value !== "string") return value;
  const key = value.trim().toUpperCase();
  const match = key.match(/^C\s*[-_:#]?\s*0*(\d+)/)
    ?? key.match(/^(?:CANDIDATE|SOURCE)\s*[-_:#]?\s*0*(\d+)/);
  return match ? `C${Number(match[1])}` : key;
}

const candidateKeySchema = z.preprocess(
  normalizeCandidateKey,
  z.string().trim().min(1).max(120),
);

const findingSchema = z.object({
  candidateKey: candidateKeySchema,
  claim: z.string().min(20).max(700),
  evidenceQuote: z.string().min(20).max(900),
  confidence: z.number().min(0).max(1),
  section: z.enum(["must_know", "exact_moment", "archive", "serendipity"]),
  explanation: z.string().min(20).max(900),
  whyNow: z.string().min(15).max(600),
  tasteRules: z.array(z.string().max(300)).min(1).max(3),
  attentionMinutes: z.number().int().min(1).max(30),
  scores: z.object({
    focusRelevance: z.number().min(0).max(100),
    tasteFit: z.number().min(0).max(100),
    novelty: z.number().min(0).max(100),
    evidenceQuality: z.number().min(0).max(100),
    sourceTrust: z.number().min(0).max(100),
    redundancy: z.number().min(0).max(100),
  }),
});

const directorOutputSchema = z.object({
  title: z.string().min(10).max(140),
  summary: z.string().min(30).max(1000),
  findings: z.array(findingSchema).max(5),
  rejections: z
    .array(
      z.object({
        candidateKey: z.string().min(1).max(120),
        reason: z.string().min(10).max(500),
      }),
    )
    .max(8),
});

type DirectorOutput = z.infer<typeof directorOutputSchema>;
type VideoSegment = VideoDbTranscriptSegment;

type FetchedCandidate = {
  key: string;
  id: Id<"candidates">;
  title: string;
  url: string;
  sourceName: string;
  markdown: string;
  kind: "web" | "video";
  video?: {
    id: string;
    lengthSeconds: number;
    segments: VideoSegment[];
  };
};

type FetchedSource = Omit<FetchedCandidate, "key">;

type CandidateSeed = {
  result: TextSearchResult;
  contentType: "web" | "paper" | "video";
  discoveredBy: string;
  candidateId?: Id<"candidates">;
};

type HermesStatus = {
  status: string;
  output?: string;
  error?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

type ResearchContext = {
  run: {
    focusSnapshot: {
      currentWork: string;
      outcome: string;
      assignment: string;
      knownContext: string;
      sourceScope: string[];
      freshness: string;
      briefingSize: string;
      serendipity: number;
    };
  };
  tasteDoc: { version: number; markdown: string };
  archive: Array<{ title: string; claimText: string }>;
};

function hostName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown source";
  }
}

function freshnessStart(label: string) {
  const now = new Date();
  if (label === "Past 30 days") now.setDate(now.getDate() - 30);
  else if (label === "Past 6 months") now.setMonth(now.getMonth() - 6);
  else if (label === "Past 12 months") now.setFullYear(now.getFullYear() - 1);
  else return undefined;
  return now.toISOString();
}

function contentType(url: string): "web" | "paper" | "video" {
  const lower = url.toLowerCase();
  if (lower.includes("arxiv.org") || lower.endsWith(".pdf") || lower.includes("doi.org")) return "paper";
  if (lower.includes("youtube.com") || lower.includes("youtu.be") || lower.includes("vimeo.com")) return "video";
  return "web";
}

function cleanMarkdown(markdown: string) {
  return markdown
    .replace(/\r/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 7_000);
}

function recoverExactQuote(markdown: string, quote: string) {
  const normalize = (value: string, withMap: boolean) => {
    let text = "";
    const map: number[] = [];
    let previousWasSpace = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      // Models commonly omit harmless Markdown emphasis markers around copied text.
      if ("*_`#".includes(character)) continue;
      const normalizedCharacter = /\s/.test(character)
        ? " "
        : character.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
      if (normalizedCharacter === " " && previousWasSpace) continue;
      text += normalizedCharacter;
      if (withMap) map.push(index);
      previousWasSpace = normalizedCharacter === " ";
    }
    return { text: withMap ? text : text.trim(), map };
  };
  const source = normalize(markdown, true);
  const target = normalize(quote, false).text;
  if (target.length < 20) return null;
  const offset = source.text.indexOf(target);
  if (offset < 0) return null;
  const start = source.map[offset];
  const end = source.map[offset + target.length - 1];
  if (start === undefined || end === undefined) return null;
  return markdown.slice(start, end + 1);
}

function timestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function sourceChunk(markdown: string, quote: string) {
  const offset = markdown.indexOf(quote);
  if (offset < 0) return null;
  const start = Math.max(0, offset - 380);
  const end = Math.min(markdown.length, offset + quote.length + 380);
  const chunk = markdown.slice(start, end).trim();
  const before = markdown.slice(0, offset);
  const paragraph = before.split(/\n\s*\n/).length;
  const headings = before.match(/^#{1,4}\s+.+$/gm);
  const heading = headings?.at(-1)?.replace(/^#+\s*/, "");
  return {
    chunk,
    locator: heading ? `${heading} · paragraph ${paragraph}` : `Paragraph ${paragraph}`,
    hash: createHash("sha256").update(chunk).digest("hex"),
  };
}

function videoSourceChunk(source: FetchedCandidate, requestedQuote: string) {
  if (!source.video) return null;
  for (let index = 0; index < source.video.segments.length; index += 1) {
    const segment = source.video.segments[index];
    const exactQuote = segment.text.includes(requestedQuote)
      ? requestedQuote
      : recoverExactQuote(segment.text, requestedQuote);
    if (!exactQuote) continue;
    const surrounding = source.video.segments.slice(Math.max(0, index - 1), index + 2);
    const chunk = surrounding
      .map((item) => `[${timestamp(item.start)}–${timestamp(item.end)}] ${item.text}`)
      .join("\n")
      .trim();
    return {
      exactQuote,
      chunk,
      locator: `VideoDB spoken-word transcript · ${timestamp(segment.start)}–${timestamp(segment.end)}`,
      hash: createHash("sha256").update(chunk).digest("hex"),
      startSeconds: segment.start,
      endSeconds: segment.end,
    };
  }
  return null;
}

function parseJsonOutput(raw: string): DirectorOutput {
  const withoutFence = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) throw new Error("Hermes returned no JSON object.");
  return directorOutputSchema.parse(JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)));
}

function buildDirectorPrompt(
  context: ResearchContext,
  sources: FetchedCandidate[],
) {
  const sourceBlock = sources
    .map((source) => {
      if (source.kind === "video" && source.video) {
        const transcript = source.video.segments
          .map((segment) => `[${timestamp(segment.start)}–${timestamp(segment.end)}] ${segment.text}`)
          .join("\n");
        return `\n<source id="${source.key}" type="videodb_transcript" videodb_id="${source.video.id}" title="${source.title.replaceAll('"', "'")}" url="${source.url}">\n${transcript}\n</source>`;
      }
      return `\n<source id="${source.key}" type="primary_text" title="${source.title.replaceAll('"', "'")}" url="${source.url}">\n${source.markdown}\n</source>`;
    })
    .join("\n");
  const archive = context.archive
    .map((entry) => `- ${entry.title}: ${entry.claimText}`)
    .join("\n");
  const target = Math.min(Number.parseInt(context.run.focusSnapshot.briefingSize, 10) || 3, sources.length);
  const videoKeys = sources.filter((source) => source.kind === "video").map((source) => source.key);
  const textKeys = sources.filter((source) => source.kind === "web").map((source) => source.key);

  return `Execute one bounded Cerno research review. Use delegate_task once with exactly three parallel specialists:
1) Evidence Analyst: inspect primary-text sources ${textKeys.join(", ") || "none; cross-check the transcript evidence instead"}.
2) ${videoKeys.length ? `Video Analyst: inspect VideoDB transcript sources ${videoKeys.join(", ")} and identify exact timestamped moments` : `Evidence Analyst B: independently inspect sources ${sources.filter((_, index) => index % 2 === 1).map((item) => item.key).join(", ")}`}.
3) Personal Editor: compare the candidate set with the TasteDoc, Focus Thread, and personal archive below.
After all three return, act as Research Director: select exactly ${target} strongest non-redundant findings, check every quote, title the briefing from accepted evidence, and reject the remaining candidates.

FOCUS THREAD
Current work: ${context.run.focusSnapshot.currentWork}
Desired outcome: ${context.run.focusSnapshot.outcome}
Research assignment: ${context.run.focusSnapshot.assignment}
Known context / skip instructions: ${context.run.focusSnapshot.knownContext || "None supplied"}
Freshness: ${context.run.focusSnapshot.freshness}
Serendipity budget: ${context.run.focusSnapshot.serendipity}%

TASTEDOC v${context.tasteDoc.version}
${context.tasteDoc.markdown}

PERSONAL ARCHIVE (comparison context, not source evidence)
${archive || "No prior claims."}

FETCHED PRIMARY SOURCES
${sourceBlock}

PUBLICATION CONTRACT
- Search metadata is not evidence. Use only text inside the <source> blocks.
- candidateKey must be exactly the source id (for example C1 or C2). If multiple findings come from C2, use C2 for each; never create suffixes such as C2-1 or C2-topic.
- evidenceQuote must be one exact, contiguous substring copied character-for-character from that source. Do not remove markdown markers, alter punctuation, or use ellipses.
- For a videodb_transcript source, copy only spoken text from inside one timestamped line; do not include the [start–end] prefix. Use section exact_moment.
- A claim must not exceed what its exact quote supports.
- Prefer primary evidence, measurements, operational detail, and material that changes a decision.
- Mark novelty relative to the personal archive; do not present an archive item as fresh evidence.
- Scores are integers from 0 to 100. redundancy is a penalty score.
- Use section "exact_moment" only for timestamped audiovisual evidence; otherwise use must_know, archive, or serendipity.
- Return ONLY one valid JSON object, no markdown, with this exact shape:
{"title":"evidence-derived title","summary":"decision-ready synthesis","findings":[{"candidateKey":"C1","claim":"atomic supported claim","evidenceQuote":"exact source substring","confidence":0.9,"section":"must_know","explanation":"why Cerno selected this for this person","whyNow":"why it matters to the current work","tasteRules":["applicable rule"],"attentionMinutes":4,"scores":{"focusRelevance":90,"tasteFit":85,"novelty":70,"evidenceQuality":90,"sourceTrust":80,"redundancy":10}}],"rejections":[{"candidateKey":"C4","reason":"specific rejection reason"}]}`;
}

async function fetchHermesEvents(url: string, key: string, runId: string) {
  try {
    const response = await fetch(`${url}/v1/runs/${runId}/events`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    const started = text.match(/"event":\s*"tool\.started"[^\n]+"tool":\s*"delegate_task"/g)?.length ?? 0;
    const duration = text.match(/"tool":\s*"delegate_task"[^\n]+"duration":\s*([0-9.]+)/)?.[1];
    return { started, duration };
  } catch {
    return null;
  }
}

export const execute = internalAction({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }) => {
    let directorStep: Id<"agentSteps"> | undefined;
    let scoutStep: Id<"agentSteps"> | undefined;
    let analystAStep: Id<"agentSteps"> | undefined;
    let analystBStep: Id<"agentSteps"> | undefined;
    let editorStep: Id<"agentSteps"> | undefined;
    let reviewStep: Id<"agentSteps"> | undefined;

    try {
      const context = await ctx.runQuery(internal.research.loadContext, { runId });
      await ctx.runMutation(internal.research.updateRun, {
        runId,
        status: "planning",
        phase: "Director is interpreting the research contract",
        startedAt: Date.now(),
      });
      directorStep = await ctx.runMutation(internal.research.createStep, {
        runId,
        role: "Research Director",
        label: "Plan bounded research",
        assignment: "Translate the Focus Thread into source and evidence requirements.",
        status: "running",
        order: 1,
      });
      await ctx.runMutation(internal.research.addEvent, {
        runId,
        type: "director.started",
        label: "Research Director started",
        detail: "The run is bound to an immutable Focus Thread snapshot and approved TasteDoc version.",
      });

      const linkupKey = process.env.LINKUP_API_KEY;
      if (!linkupKey) throw new Error("LINKUP_API_KEY is not configured in the Convex environment.");
      const linkup = new LinkupClient({ apiKey: linkupKey });
      await ctx.runMutation(internal.research.updateRun, {
        runId,
        status: "discovering",
        phase: "Scout is searching live sources",
      });
      scoutStep = await ctx.runMutation(internal.research.createStep, {
        runId,
        parentStepId: directorStep!,
        role: "Scout",
        label: "Discover and triage candidates",
        assignment: "Search selected live lanes; preserve snippets as discovery metadata and route one video through VideoDB when requested.",
        status: "running",
        order: 2,
      });

      const sourceScope = context.run.focusSnapshot.sourceScope;
      const wantsVideo = sourceScope.includes("Long-form video");
      const wantsText = sourceScope.includes("Live web") || sourceScope.includes("Research papers");
      const query = `${context.run.focusSnapshot.assignment}. Current work: ${context.run.focusSnapshot.currentWork}. Desired outcome: ${context.run.focusSnapshot.outcome}. Find recent primary sources, technical reports, research papers, or first-party engineering evidence. ${context.run.focusSnapshot.knownContext ? `Avoid repeating: ${context.run.focusSnapshot.knownContext}` : ""}`;
      const fromDate = freshnessStart(context.run.focusSnapshot.freshness);
      const searches = await Promise.allSettled([
        wantsText
          ? linkup.search({
              query,
              depth: "standard",
              outputType: "searchResults",
              maxResults: wantsVideo ? 5 : 7,
              ...(fromDate ? { fromDate } : {}),
            })
          : Promise.resolve(null),
        wantsVideo
          ? linkup.search({
              query: `${context.run.focusSnapshot.assignment}. Find a substantive long-form conference talk, technical interview, or first-party presentation with spoken evidence. site:youtube.com`,
              depth: "standard",
              outputType: "searchResults",
              maxResults: 3,
              ...(fromDate ? { fromDate } : {}),
            })
          : Promise.resolve(null),
      ]);
      const baseResponse = searches[0].status === "fulfilled" ? searches[0].value : null;
      const videoResponse = searches[1].status === "fulfilled" ? searches[1].value : null;
      const baseSeeds: CandidateSeed[] = (baseResponse?.results ?? [])
        .filter((item): item is TextSearchResult => item.type === "text")
        .filter((item) => wantsVideo || contentType(item.url) !== "video")
        .map((result) => ({
          result,
          contentType: contentType(result.url),
          discoveredBy: "LinkUp live search",
        }));
      const videoSeeds: CandidateSeed[] = (videoResponse?.results ?? [])
        .filter((item): item is TextSearchResult => item.type === "text" && contentType(item.url) === "video")
        .map((result) => ({
          result,
          contentType: "video",
          discoveredBy: "LinkUp video discovery → VideoDB",
        }));
      const seeds = [...baseSeeds, ...videoSeeds]
        .filter((seed, index, all) => all.findIndex((other) => other.result.url === seed.result.url) === index)
        .slice(0, 7);
      if (seeds.length === 0) throw new Error("LinkUp returned no candidates for this research contract.");

      const candidateIds = await ctx.runMutation(internal.research.saveCandidates, {
        runId,
        candidates: seeds.map((seed) => ({
          url: seed.result.url,
          title: seed.result.name,
          sourceName: hostName(seed.result.url),
          description: seed.result.content.slice(0, 500),
          contentType: seed.contentType,
          discoveredBy: seed.discoveredBy,
        })),
      });
      seeds.forEach((seed, index) => { seed.candidateId = candidateIds[index]; });
      await ctx.runMutation(internal.research.updateStep, {
        stepId: scoutStep!,
        status: "complete",
        summary: `${seeds.length} candidates discovered${videoSeeds.length ? `, including ${videoSeeds.length} video candidate${videoSeeds.length === 1 ? "" : "s"}` : ""}; snippets retained only as discovery metadata.`,
        toolCalls: wantsVideo ? 2 : 1,
      });
      await ctx.runMutation(internal.research.addEvent, {
        runId,
        type: "discovery.complete",
        label: `${seeds.length} live candidates discovered`,
        detail: wantsVideo
          ? "Cerno will fetch selected pages and ask VideoDB for one timestamped spoken-word evidence lane."
          : "Cerno will fetch selected primary pages before any claim can be published.",
      });

      await ctx.runMutation(internal.research.updateRun, {
        runId,
        status: "analyzing",
        phase: wantsVideo ? "Fetching primary text and indexing one VideoDB source" : "Fetching selected sources beyond search snippets",
      });
      const selectedSeeds = [
        ...seeds.filter((seed) => seed.contentType !== "video").slice(0, wantsVideo ? 3 : 4),
        ...seeds.filter((seed) => seed.contentType === "video").slice(0, wantsVideo ? 1 : 0),
      ];
      const videoDbKey = process.env.VIDEO_DB_API_KEY || process.env.VIDEODB_API_KEY;
      const videoDb = videoDbKey ? new VideoDbClient(videoDbKey) : null;
      const fetchedSettled = await Promise.allSettled(
        selectedSeeds.map(async (seed): Promise<FetchedSource> => {
          const candidateId = seed.candidateId!;
          await ctx.runMutation(internal.research.markCandidate, { candidateId, status: "selected" });

          if (seed.contentType === "video") {
            if (!videoDb) throw new Error("VIDEO_DB_API_KEY is not configured in the Convex environment.");
            const existing = await ctx.runQuery(internal.research.getVideoAsset, {
              workspaceId: context.run.workspaceId,
              sourceUrl: seed.result.url,
            });
            let videoId = existing?.videoDbId;
            let lengthSeconds = existing?.lengthSeconds ?? 0;
            let streamUrl = existing?.streamUrl;
            let suppliedPlayerUrl = existing?.playerUrl;
            let indexed = existing?.status === "indexed";

            if (!videoId || existing?.status === "failed") {
              const uploaded = await videoDb.uploadUrl(
                seed.result.url,
                seed.result.name,
                `Cerno evidence source for Research Run ${runId}`,
              );
              videoId = uploaded.id;
              lengthSeconds = Number(uploaded.length ?? 0) || 0;
              streamUrl = uploaded.stream_url;
              suppliedPlayerUrl = uploaded.player_url;
              indexed = false;
              await ctx.runMutation(internal.research.upsertVideoAsset, {
                workspaceId: context.run.workspaceId,
                sourceUrl: seed.result.url,
                videoDbId: videoId,
                name: seed.result.name,
                lengthSeconds,
                streamUrl,
                playerUrl: videoDbPlayerUrl(streamUrl, suppliedPlayerUrl),
                status: "uploaded",
              });
            }
            if (!indexed) {
              await videoDb.indexSpokenWords(videoId);
              await ctx.runMutation(internal.research.upsertVideoAsset, {
                workspaceId: context.run.workspaceId,
                sourceUrl: seed.result.url,
                videoDbId: videoId,
                name: seed.result.name,
                lengthSeconds,
                streamUrl,
                playerUrl: videoDbPlayerUrl(streamUrl, suppliedPlayerUrl),
                status: "indexed",
              });
            }

            let shots: VideoDbShot[] = [];
            try {
              shots = await videoDb.searchSpokenWords(videoId, context.run.focusSnapshot.assignment);
            } catch {
              shots = [];
            }
            const transcriptBatches = shots.length
              ? await Promise.allSettled(
                  shots.slice(0, 4).map((shot) => videoDb.transcript(videoId!, Math.max(0, shot.start - 2), shot.end + 2)),
                )
              : [{ status: "fulfilled" as const, value: await videoDb.transcript(videoId) }];
            const rawSegments = transcriptBatches.flatMap((batch) => batch.status === "fulfilled" ? batch.value : []);
            const sourceSegments = (rawSegments.length ? rawSegments : shots.map((shot) => ({ start: shot.start, end: shot.end, text: shot.text })))
              .sort((a, b) => a.start - b.start)
              .filter((segment, index, all) => all.findIndex((other) => other.start === segment.start && other.end === segment.end && other.text === segment.text) === index);
            const segments: VideoSegment[] = [];
            let transcriptCharacters = 0;
            for (const segment of sourceSegments) {
              if (transcriptCharacters + segment.text.length > 10_000) break;
              segments.push(segment);
              transcriptCharacters += segment.text.length;
            }
            if (segments.length === 0 || transcriptCharacters < 200) {
              throw new Error("VideoDB produced no sufficiently detailed timestamped transcript evidence.");
            }
            await ctx.runMutation(internal.research.attachVideoMetadata, {
              candidateId,
              videoDbId: videoId,
              streamUrl,
              playerUrl: videoDbPlayerUrl(streamUrl, suppliedPlayerUrl),
              durationSeconds: lengthSeconds,
            });
            await ctx.runMutation(internal.research.addEvent, {
              runId,
              type: "videodb.indexed",
              label: "VideoDB evidence lane ready",
              detail: `${segments.length} timestamped transcript segments were retrieved from ${videoId}; semantic search moments remain linked to playable streams.`,
            });
            await ctx.runMutation(internal.research.markCandidate, { candidateId, status: "consumed" });
            return {
              id: candidateId,
              title: seed.result.name,
              url: seed.result.url,
              sourceName: hostName(seed.result.url),
              markdown: segments.map((segment) => segment.text).join("\n\n"),
              kind: "video",
              video: {
                id: videoId,
                lengthSeconds,
                segments,
              },
            };
          }

          const result = await linkup.fetch({ url: seed.result.url, renderJs: false });
          const markdown = cleanMarkdown(result.markdown);
          if (markdown.length < 600) throw new Error("Fetched source was too short to support evidence.");
          await ctx.runMutation(internal.research.markCandidate, { candidateId, status: "consumed" });
          return {
            id: candidateId,
            title: seed.result.name,
            url: seed.result.url,
            sourceName: hostName(seed.result.url),
            markdown,
            kind: "web",
          };
        }),
      );
      const fetched: FetchedCandidate[] = [];
      for (let index = 0; index < fetchedSettled.length; index += 1) {
        const result = fetchedSettled[index];
        if (result.status === "fulfilled") fetched.push({ ...result.value, key: `C${fetched.length + 1}` });
        else {
          const seed = selectedSeeds[index];
          await ctx.runMutation(internal.research.markCandidate, {
            candidateId: seed.candidateId!,
            status: "unavailable",
            rejectionReason: seed.contentType === "video"
              ? `VideoDB could not produce timestamped evidence: ${result.reason instanceof Error ? result.reason.message.slice(0, 280) : "unknown failure"}`
              : "Primary source fetch failed; search metadata was not used as evidence.",
          });
        }
      }
      const requiredSources = wantsText ? 2 : 1;
      if (fetched.length < requiredSources) throw new Error(`Fewer than ${requiredSources} source${requiredSources === 1 ? "" : "s"} could be consumed as primary evidence.`);
      await ctx.runMutation(internal.research.updateRun, {
        runId,
        consumedCount: fetched.length,
        phase: "Hermes is delegating parallel evidence review",
      });

      const videoSources = fetched.filter((source) => source.kind === "video");
      const textSources = fetched.filter((source) => source.kind === "web");
      analystAStep = await ctx.runMutation(internal.research.createStep, {
        runId,
        parentStepId: directorStep!,
        role: "Evidence Analyst",
        label: "Inspect primary-source evidence",
        assignment: `Read ${textSources.map((item) => item.key).join(", ") || fetched.map((item) => item.key).join(", ")} and return exact quotes.`,
        status: "running",
        order: 3,
      });
      analystBStep = await ctx.runMutation(internal.research.createStep, {
        runId,
        parentStepId: directorStep!,
        role: videoSources.length ? "Video Analyst" : "Evidence Analyst B",
        label: videoSources.length ? "Inspect timestamped VideoDB evidence" : "Inspect primary-source evidence",
        assignment: videoSources.length
          ? `Read ${videoSources.map((item) => item.key).join(", ")} and return one exact spoken passage with its VideoDB timestamp.`
          : `Read ${fetched.filter((_, index) => index % 2 === 1).map((item) => item.key).join(", ")} and return exact quotes.`,
        status: "running",
        order: 4,
      });
      editorStep = await ctx.runMutation(internal.research.createStep, {
        runId,
        parentStepId: directorStep!,
        role: "Personal Editor",
        label: "Judge novelty and personal value",
        assignment: "Compare candidates with the Focus Thread, TasteDoc, and prior archive claims.",
        status: "running",
        order: 5,
      });

      const hermesKey = process.env.HERMES_API_KEY;
      const hermesUrl = (process.env.HERMES_URL || HERMES_DEFAULT_URL).replace(/\/$/, "");
      if (!hermesKey) throw new Error("HERMES_API_KEY is not configured in the Convex environment.");
      const prompt = buildDirectorPrompt(context, fetched);
      let hermesStatus: HermesStatus | null = null;
      let hermesRunId = "";
      let lastHermesError = "Hermes did not return a terminal response.";

      // One bounded infrastructure retry is allowed. It creates a separate Hermes run
      // and remains visible in Cerno's event ledger rather than silently looping.
      for (let runtimeAttempt = 0; runtimeAttempt < 2; runtimeAttempt += 1) {
        if (runtimeAttempt === 1) {
          // Give the previous run time to release gateway/model concurrency before
          // consuming the single retry budget.
          await new Promise((resolve) => setTimeout(resolve, 15_000));
          await ctx.runMutation(internal.research.addEvent, {
            runId,
            type: "hermes.retry",
            label: "Hermes infrastructure retry 1/1",
            detail: lastHermesError.slice(0, 400),
          });
        }
        const submitResponse = await fetch(`${hermesUrl}/v1/runs`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hermesKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `cerno-${runId}-attempt-${runtimeAttempt + 1}`,
          },
          body: JSON.stringify({
            input: prompt,
            session_id: runtimeAttempt === 0 ? String(runId) : `${runId}-retry-1`,
            instructions: "Operate as Cerno's Research Director. Use native delegate_task exactly as requested. Never invent evidence. Return only the requested JSON object.",
          }),
        });
        if (!submitResponse.ok) {
          lastHermesError = `Hermes rejected attempt ${runtimeAttempt + 1} (${submitResponse.status}).`;
          continue;
        }
        const submission = (await submitResponse.json()) as { run_id?: string; id?: string };
        hermesRunId = submission.run_id ?? submission.id ?? "";
        if (!hermesRunId) {
          lastHermesError = "Hermes returned no run ID.";
          continue;
        }
        await ctx.runMutation(internal.research.updateRun, { runId, hermesRunId });
        await ctx.runMutation(internal.research.addEvent, {
          runId,
          type: "hermes.submitted",
          label: runtimeAttempt === 0 ? "Hermes run accepted" : "Hermes retry accepted",
          detail: `Runtime correlation ID ${hermesRunId}. Three specialist assignments were submitted for native delegation.`,
        });

        hermesStatus = null;
        for (let pollAttempt = 0; pollAttempt < 120; pollAttempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          const currentStatus = await ctx.runQuery(internal.research.getStatus, { runId });
          if (currentStatus === "cancelled") {
            await fetch(`${hermesUrl}/v1/runs/${hermesRunId}/stop`, {
              method: "POST",
              headers: { Authorization: `Bearer ${hermesKey}` },
            }).catch(() => undefined);
            return;
          }
          const statusResponse = await fetch(`${hermesUrl}/v1/runs/${hermesRunId}`, {
            headers: { Authorization: `Bearer ${hermesKey}` },
          });
          if (!statusResponse.ok) continue;
          hermesStatus = (await statusResponse.json()) as HermesStatus;
          if (["completed", "failed", "stopped", "cancelled"].includes(hermesStatus.status)) break;
        }
        if (hermesStatus?.status === "completed" && hermesStatus.output) break;
        lastHermesError = `Attempt ${runtimeAttempt + 1} did not complete${hermesStatus?.error ? `: ${hermesStatus.error}` : "."}`;
      }
      if (!hermesStatus || hermesStatus.status !== "completed" || !hermesStatus.output) {
        throw new Error(lastHermesError);
      }

      const observed = await fetchHermesEvents(hermesUrl, hermesKey, hermesRunId);
      await ctx.runMutation(internal.research.addEvent, {
        runId,
        type: "hermes.delegation",
        label: observed?.started ? "Native delegation observed" : "Hermes specialist review completed",
        detail: observed?.started
          ? `Hermes emitted ${observed.started} delegate_task start event${observed.started === 1 ? "" : "s"}${observed.duration ? `; tool duration ${observed.duration}s` : ""}.`
          : "Hermes completed the Director review; the runtime event stream remains linked by run ID.",
      });
      await Promise.all([
        ctx.runMutation(internal.research.updateStep, {
          stepId: analystAStep!,
          status: "complete",
          summary: "Returned candidate claims with exact source excerpts for Director review.",
          toolCalls: 1,
        }),
        ctx.runMutation(internal.research.updateStep, {
          stepId: analystBStep!,
          status: "complete",
          summary: videoSources.length
            ? "Returned timestamped transcript analysis from the VideoDB evidence lane."
            : "Returned independent source analysis and rejection signals.",
          toolCalls: 1,
        }),
        ctx.runMutation(internal.research.updateStep, {
          stepId: editorStep!,
          status: "complete",
          summary: "Compared candidates against durable taste, active focus, and prior claims.",
          toolCalls: 1,
        }),
      ]);

      await ctx.runMutation(internal.research.updateRun, {
        runId,
        status: "validating",
        phase: "Validating exact evidence locators",
      });
      reviewStep = await ctx.runMutation(internal.research.createStep, {
        runId,
        parentStepId: directorStep!,
        role: "Research Director",
        label: "Review and validate publication",
        assignment: "Reject unsupported claims and publish only exact source-backed findings.",
        status: "running",
        order: 6,
      });

      const output = parseJsonOutput(hermesStatus.output);
      const sourceByKey = new Map(fetched.map((source) => [source.key, source]));
      const usedEvidence = new Set<string>();
      const validatedFindings = [];
      const failedValidation: { key: string; reason: string }[] = [];
      for (const finding of output.findings) {
        const source = sourceByKey.get(finding.candidateKey);
        if (!source) {
          failedValidation.push({ key: finding.candidateKey, reason: "Unknown candidate reference." });
          continue;
        }
        if (source.kind === "video") {
          const videoChunk = videoSourceChunk(source, finding.evidenceQuote);
          if (!videoChunk || !source.video || !videoDb) {
            failedValidation.push({ key: finding.candidateKey, reason: "Evidence quote was not an exact substring of one timestamped VideoDB transcript segment." });
            continue;
          }
          let streamUrl: string | undefined;
          let playableUrl: string | undefined;
          try {
            const stream = await videoDb.momentStream(
              source.video.id,
              videoChunk.startSeconds,
              videoChunk.endSeconds,
              source.video.lengthSeconds,
            );
            streamUrl = stream.stream_url;
            playableUrl = videoDbPlayerUrl(streamUrl, stream.player_url);
          } catch {
            streamUrl = undefined;
            playableUrl = undefined;
          }
          if (!streamUrl || !playableUrl) {
            failedValidation.push({ key: finding.candidateKey, reason: "VideoDB transcript matched, but no playable timestamped evidence stream could be generated." });
            continue;
          }
          const evidenceKey = `${finding.candidateKey}\u0000${videoChunk.exactQuote}`;
          if (usedEvidence.has(evidenceKey)) {
            failedValidation.push({ key: finding.candidateKey, reason: "Duplicate evidence passage." });
            continue;
          }
          usedEvidence.add(evidenceKey);
          validatedFindings.push({
            candidateId: source.id,
            claim: finding.claim,
            evidenceQuote: videoChunk.exactQuote,
            chunkText: videoChunk.chunk,
            locator: videoChunk.locator,
            contentHash: videoChunk.hash,
            startSeconds: videoChunk.startSeconds,
            endSeconds: videoChunk.endSeconds,
            streamUrl,
            playerUrl: playableUrl,
            confidence: finding.confidence,
            section: "exact_moment" as const,
            explanation: finding.explanation,
            whyNow: finding.whyNow,
            tasteRules: finding.tasteRules,
            attentionMinutes: finding.attentionMinutes,
            ...finding.scores,
          });
          continue;
        }

        const exactQuote = source.markdown.includes(finding.evidenceQuote)
          ? finding.evidenceQuote
          : recoverExactQuote(source.markdown, finding.evidenceQuote);
        const chunk = exactQuote ? sourceChunk(source.markdown, exactQuote) : null;
        if (!chunk || !exactQuote) {
          failedValidation.push({ key: finding.candidateKey, reason: "Evidence quote was not an exact source substring." });
          continue;
        }
        const evidenceKey = `${finding.candidateKey}\u0000${exactQuote}`;
        if (usedEvidence.has(evidenceKey)) {
          failedValidation.push({ key: finding.candidateKey, reason: "Duplicate evidence passage." });
          continue;
        }
        usedEvidence.add(evidenceKey);
        validatedFindings.push({
          candidateId: source.id,
          claim: finding.claim,
          evidenceQuote: exactQuote,
          chunkText: chunk.chunk,
          locator: chunk.locator,
          contentHash: chunk.hash,
          confidence: finding.confidence,
          section: finding.section,
          explanation: finding.explanation,
          whyNow: finding.whyNow,
          tasteRules: finding.tasteRules,
          attentionMinutes: finding.attentionMinutes,
          ...finding.scores,
        });
      }
      const minimum = Math.min(Number.parseInt(context.run.focusSnapshot.briefingSize, 10) || 3, fetched.length);
      if (validatedFindings.length < minimum) {
        throw new Error(`${validatedFindings.length}/${minimum} required findings passed exact evidence validation. Unsupported claims were not published.`);
      }

      const explicitRejections = output.rejections
        .map((rejection) => {
          const source = sourceByKey.get(rejection.candidateKey);
          return source ? { candidateId: source.id, reason: rejection.reason } : null;
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);
      const validationRejections = failedValidation
        .map((failure) => {
          const source = sourceByKey.get(failure.key);
          return source ? { candidateId: source.id, reason: failure.reason } : null;
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);
      const usage = hermesStatus.usage ?? {};
      const briefingId = await ctx.runMutation(internal.research.publish, {
        runId,
        title: output.title,
        summary: output.summary,
        findings: validatedFindings,
        rejections: [...explicitRejections, ...validationRejections],
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        estimatedCostUsd: 0,
      });
      await ctx.runMutation(internal.research.updateStep, {
        stepId: reviewStep!,
        status: "complete",
        summary: `${validatedFindings.length} findings passed exact quote, candidate, and locator checks. Briefing ${briefingId} published.`,
        toolCalls: 1,
      });
      await ctx.runMutation(internal.research.updateStep, {
        stepId: directorStep!,
        status: "complete",
        summary: "Bounded research completed and one canonical briefing was published.",
        toolCalls: 2,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown research failure";
      await ctx.runMutation(internal.research.fail, { runId, error: message });
    }
  },
});

export const stopHermes = internalAction({
  args: { hermesRunId: v.string() },
  handler: async (_ctx, { hermesRunId }) => {
    const key = process.env.HERMES_API_KEY;
    const url = (process.env.HERMES_URL || HERMES_DEFAULT_URL).replace(/\/$/, "");
    if (!key) return;
    await fetch(`${url}/v1/runs/${hermesRunId}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    }).catch(() => undefined);
  },
});
