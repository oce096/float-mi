// lib/spinoff-storage.ts
// 「番外馆」（藏书阁与剧场指令卷宗）数据层：
// 1. 番外指令库（文件夹分类 + 可串接后续系列章节的指令档案）
// 2. 角色番外藏书阁（每个角色一份档案 → 每一本书籍对应一部玩过的番外卷宗，书名/封面色调可自定义）
// 3. 生成引擎桥：完整读取角色人设、关系、核心/长期/短期记忆，但绝不回写总结到线上或线下（纯粹番外平行空间）

import { kvGet, kvSet, registerKvMigration, registerDynamicPrefix } from "./kv-db";
import { loadCharacters } from "./character-storage";
import { createOrGetSession, type ChatMessage, type ChatSession } from "./chat-storage";
import {
    loadBindingConfig,
    loadApiConfigs,
    loadPresets,
    loadWorldBooks,
    loadRegexes,
    resolveBinding,
    resolveUserIdentity,
    applyWorldBookEntryOverrides,
} from "./settings-storage";
import type { WorldBookConfig } from "./settings-types";
import {
    buildChatPromptMessages,
    sendLLMStreamRequest,
    sendLLMRequest,
    stripPresetTexts,
    stripOnlineThinkingTag,
} from "./chat-engine";
import { parseOfflineResponse, extractThinkingTag } from "./chat-offline-storage";
import {
    loadOfflineCotPresets,
    loadOfflineStylePresets,
    DEFAULT_COT_PRESETS,
    DEFAULT_STYLE_PRESETS,
} from "./offline-studio-storage";

const SPINOFF_FOLDERS_KEY = "ai_phone_spinoff_folders_v1";
const SPINOFF_DIRECTIVES_KEY = "ai_phone_spinoff_directives_v1";
const SPINOFF_BOOKS_KEY = "ai_phone_spinoff_books_v1";
const SPINOFF_TURNS_PREFIX = "ai_phone_spinoff_turns_v1:";
const SPINOFF_CHAR_STUDIO_PREFIX = "ai_phone_spinoff_char_studio_v1:";

registerKvMigration(SPINOFF_FOLDERS_KEY);
registerKvMigration(SPINOFF_DIRECTIVES_KEY);
registerKvMigration(SPINOFF_BOOKS_KEY);
registerDynamicPrefix(SPINOFF_TURNS_PREFIX);
registerDynamicPrefix(SPINOFF_CHAR_STUDIO_PREFIX);

export const SPINOFF_UPDATED_EVENT = "spinoff-archive-updated";

export type SpinoffFolder = {
    id: string;
    name: string;
    badge?: string;
    order: number;
};

/** 一条收集的「番外指令 / 小剧场梗」档案，可含多个后续章节指令 */
export type SpinoffDirectiveChapter = {
    id: string;
    title: string; // 如「第一幕 · 初遇」「后续 · 醉酒袒露」
    prompt: string;
};

export type SpinoffDirective = {
    id: string;
    folderId: string;
    title: string;
    premise: string; // 一句话梗概/导语
    prompt: string; // 主指令正文
    chapters?: SpinoffDirectiveChapter[]; // 后续系列幕次（放在同一个档案里）
    tags?: string[];
    createdAt: string;
    updatedAt: string;
};

export type SpinoffBookTone = "burgundy" | "navy" | "forest" | "amber" | "plum" | "noir";

/** 角色藏书架上的一本「番外书籍」（对应玩过的一卷番外） */
export type SpinoffBook = {
    id: string;
    characterId: string;
    directiveId?: string; // 归属收集在哪条番外指令卷宗下（可在指令卷宗下直接翻看）
    title: string; // 书名（可随时自定义修改）
    subtitle?: string; // 副标题或指令名
    spineTone: SpinoffBookTone;
    openingPrompt?: string; // 开篇喂给角色的场景指令
    turnCount: number;
    lastPreview?: string;
    isFavorite?: boolean;
    createdAt: string;
    updatedAt: string;
};

export type SpinoffTurn = {
    id: string;
    bookId: string;
    chapterLabel?: string;
    userContent: string;
    assistantContent: string;
    thinkingText?: string;
    createdAt: string;
};

export type SpinoffCharacterStudioConfig = {
    useIndependentWorldBooks?: boolean;
    worldBookIds?: string[];
    worldBookEntryOverrides?: Record<string, boolean>;
    cotEnabled?: boolean;
    cotPresetId?: string;
    cotPrompt?: string;
    cotTag?: string;
    styleEnabled?: boolean;
    stylePresetId?: string;
    stylePrompt?: string;
    streamEnabled?: boolean;
};

const DEFAULT_FOLDERS: SpinoffFolder[] = [
    { id: "folder_if", name: "平行 IF 线", badge: "IF", order: 1 },
    { id: "folder_sweet", name: "私密日常", badge: "SWEET", order: 2 },
    { id: "folder_tension", name: "暗流拉扯", badge: "NOIR", order: 3 },
    { id: "folder_festival", name: "纪念特辑", badge: "SP", order: 4 },
];

const DEFAULT_DIRECTIVES: SpinoffDirective[] = [
    {
        id: "dir_rain_shelter",
        folderId: "folder_sweet",
        title: "暴雨停电夜 · 烛光困局",
        premise: "台风过境的深夜突然断电，手机只剩最后 5% 电量，两人被困在同一间屋子里。",
        prompt: "【番外剧场：暴雨停电夜】\n窗外暴雨倾盆，整栋楼突然陷入黑暗。室内只有一支临时找出来的香薰蜡烛微弱摇曳。请结合你与用户的既有关系与记忆，自然开启这一幕私密番外。注意细节感官（雨声、烛火阴影、呼吸距离），不改变主线设定。",
        chapters: [
            {
                id: "ch_rain_2",
                title: "后续 · 微醺真心话",
                prompt: "【番外后续：微醺真心话】\n雨还没有停，借着昏暗烛光找出了一小瓶酒。微醺之际，借着平时不会有的气氛说出一件以前藏在心里没对TA坦白过的小事。",
            },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
        id: "dir_amnesia_if",
        folderId: "folder_if",
        title: "记忆错位 · 回到初识那一天",
        premise: "一觉醒来，角色对两人的记忆暂时停留在刚认识不久的阶段，身体本能却还记得熟悉感。",
        prompt: "【平行番外：记忆错位】\n在这场平行番外中，你因为一场高烧/意外，记忆暂时停留在了与用户刚认识、还带着试探与生疏的时期；但当用户靠近时，你的下意识习惯却出卖了身体的熟悉感。请展现这种理智疏离与本能亲近的反差。",
        chapters: [
            {
                id: "ch_amnesia_2",
                title: "后续 · 记忆回笼瞬间",
                prompt: "【番外后续：记忆回笼】\n因为用户某个极其熟悉的动作或一句话，所有遗忘的相知记忆在这一刻骤然回笼。描写你眼神变化与情绪决堤的瞬间。",
            },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
        id: "dir_masquerade",
        folderId: "folder_tension",
        title: "假面晚宴 · 装作互不相识",
        premise: "在人声鼎沸的晚宴现场，两人约定假装素昧平生，却在暗处频频越界。",
        prompt: "【番外剧场：假面潜行】\n今晚的正式酒会上人多眼杂，你们事先约好在众人面前装作不认识的陌生宾客。但你在人群中穿过时，借着敬酒或擦肩的遮掩与TA进行隐秘而危险的眼神/指尖互动。",
        chapters: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    },
];

const SPINE_TONES: SpinoffBookTone[] = ["burgundy", "navy", "forest", "amber", "plum", "noir"];

function makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function emitUpdated() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SPINOFF_UPDATED_EVENT));
    }
}

// ── 文件夹 CRUD ──

export function loadSpinoffFolders(): SpinoffFolder[] {
    if (typeof window === "undefined") return DEFAULT_FOLDERS;
    try {
        const raw = kvGet(SPINOFF_FOLDERS_KEY);
        if (!raw) return DEFAULT_FOLDERS;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_FOLDERS;
    } catch {
        return DEFAULT_FOLDERS;
    }
}

export function saveSpinoffFolders(folders: SpinoffFolder[]): void {
    kvSet(SPINOFF_FOLDERS_KEY, JSON.stringify(folders));
    emitUpdated();
}

export function createSpinoffFolder(name: string, badge?: string): SpinoffFolder {
    const folders = loadSpinoffFolders();
    const created: SpinoffFolder = {
        id: makeId("sfolder"),
        name: name.trim() || "新分类卷夹",
        badge: badge?.trim().slice(0, 6).toUpperCase() || "FILE",
        order: folders.length + 1,
    };
    saveSpinoffFolders([...folders, created]);
    return created;
}

export function renameSpinoffFolder(folderId: string, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    saveSpinoffFolders(loadSpinoffFolders().map(f => (f.id === folderId ? { ...f, name: clean } : f)));
}

export function deleteSpinoffFolder(folderId: string): void {
    const folders = loadSpinoffFolders();
    if (folders.length <= 1) return;
    const remaining = folders.filter(f => f.id !== folderId);
    const fallbackId = remaining[0].id;
    saveSpinoffFolders(remaining);
    const directives = loadSpinoffDirectives().map(d => (d.folderId === folderId ? { ...d, folderId: fallbackId } : d));
    saveSpinoffDirectives(directives);
}

// ── 番外指令档案 CRUD ──

export function loadSpinoffDirectives(): SpinoffDirective[] {
    if (typeof window === "undefined") return DEFAULT_DIRECTIVES;
    try {
        const raw = kvGet(SPINOFF_DIRECTIVES_KEY);
        if (!raw) return DEFAULT_DIRECTIVES;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : DEFAULT_DIRECTIVES;
    } catch {
        return DEFAULT_DIRECTIVES;
    }
}

export function saveSpinoffDirectives(list: SpinoffDirective[]): void {
    kvSet(SPINOFF_DIRECTIVES_KEY, JSON.stringify(list));
    emitUpdated();
}

export function upsertSpinoffDirective(input: {
    id?: string;
    folderId: string;
    title: string;
    premise?: string;
    prompt: string;
    chapters?: SpinoffDirectiveChapter[];
}): SpinoffDirective {
    const all = loadSpinoffDirectives();
    const now = new Date().toISOString();
    if (input.id) {
        const idx = all.findIndex(d => d.id === input.id);
        if (idx >= 0) {
            const updated: SpinoffDirective = {
                ...all[idx],
                folderId: input.folderId,
                title: input.title.trim() || "未命名番外指令",
                premise: (input.premise ?? "").trim(),
                prompt: input.prompt.trim(),
                chapters: input.chapters ?? all[idx].chapters ?? [],
                updatedAt: now,
            };
            const next = [...all];
            next[idx] = updated;
            saveSpinoffDirectives(next);
            return updated;
        }
    }
    const created: SpinoffDirective = {
        id: makeId("sdir"),
        folderId: input.folderId,
        title: input.title.trim() || "未命名番外指令",
        premise: (input.premise ?? "").trim(),
        prompt: input.prompt.trim(),
        chapters: input.chapters ?? [],
        createdAt: now,
        updatedAt: now,
    };
    saveSpinoffDirectives([created, ...all]);
    return created;
}

export function deleteSpinoffDirective(id: string): void {
    saveSpinoffDirectives(loadSpinoffDirectives().filter(d => d.id !== id));
}

// ── 角色番外书籍（卷宗） CRUD ──

export function loadSpinoffBooks(): SpinoffBook[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(SPINOFF_BOOKS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveSpinoffBooks(books: SpinoffBook[]): void {
    kvSet(SPINOFF_BOOKS_KEY, JSON.stringify(books));
    emitUpdated();
}

export function createSpinoffBook(input: {
    characterId: string;
    title: string;
    subtitle?: string;
    directiveId?: string;
    openingPrompt?: string;
    spineTone?: SpinoffBookTone;
}): SpinoffBook {
    const books = loadSpinoffBooks();
    const now = new Date().toISOString();
    const tone = input.spineTone || SPINE_TONES[books.filter(b => b.characterId === input.characterId).length % SPINE_TONES.length];
    const book: SpinoffBook = {
        id: makeId("sbook"),
        characterId: input.characterId,
        directiveId: input.directiveId,
        title: input.title.trim() || "无题番外卷",
        subtitle: input.subtitle?.trim(),
        spineTone: tone,
        openingPrompt: input.openingPrompt?.trim(),
        turnCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    saveSpinoffBooks([book, ...books]);
    return book;
}

export function updateSpinoffBook(bookId: string, patch: Partial<Pick<SpinoffBook, "title" | "subtitle" | "directiveId" | "spineTone" | "isFavorite" | "openingPrompt">>): SpinoffBook | null {
    const books = loadSpinoffBooks();
    let updated: SpinoffBook | null = null;
    const next = books.map(book => {
        if (book.id !== bookId) return book;
        updated = {
            ...book,
            ...patch,
            title: patch.title !== undefined ? (patch.title.trim() || book.title) : book.title,
            updatedAt: new Date().toISOString(),
        };
        return updated;
    });
    if (updated) saveSpinoffBooks(next);
    return updated;
}

export function deleteSpinoffBook(bookId: string): void {
    saveSpinoffBooks(loadSpinoffBooks().filter(b => b.id !== bookId));
    kvSet(SPINOFF_TURNS_PREFIX + bookId, "[]");
}

// ── 书内回合记录读写 ──

export function loadSpinoffTurns(bookId: string): SpinoffTurn[] {
    if (!bookId || typeof window === "undefined") return [];
    try {
        const raw = kvGet(SPINOFF_TURNS_PREFIX + bookId);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function saveSpinoffTurns(bookId: string, turns: SpinoffTurn[]): void {
    kvSet(SPINOFF_TURNS_PREFIX + bookId, JSON.stringify(turns));
    const last = turns[turns.length - 1];
    const plainPreview = last
        ? (last.assistantContent || last.userContent).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 72)
        : "";
    const books = loadSpinoffBooks().map(b =>
        b.id === bookId
            ? {
                ...b,
                turnCount: turns.length,
                lastPreview: plainPreview,
                updatedAt: new Date().toISOString(),
            }
            : b,
    );
    saveSpinoffBooks(books);
}

// ── 角色番外场记配置 ──

export function loadSpinoffCharStudio(characterId: string): SpinoffCharacterStudioConfig {
    if (!characterId || typeof window === "undefined") return { cotEnabled: true, streamEnabled: true };
    try {
        const raw = kvGet(SPINOFF_CHAR_STUDIO_PREFIX + characterId);
        if (!raw) return { cotEnabled: true, streamEnabled: true };
        return { streamEnabled: true, ...JSON.parse(raw) };
    } catch {
        return { cotEnabled: true, streamEnabled: true };
    }
}

export function saveSpinoffCharStudio(characterId: string, cfg: SpinoffCharacterStudioConfig): void {
    if (!characterId || typeof window === "undefined") return;
    kvSet(SPINOFF_CHAR_STUDIO_PREFIX + characterId, JSON.stringify(cfg));
    emitUpdated();
}

export { loadOfflineCotPresets, loadOfflineStylePresets, DEFAULT_COT_PRESETS, DEFAULT_STYLE_PRESETS };

// ── 纯粹番外生成引擎（只读记忆与人设，零污染主线/不写总结） ──

export async function generateSpinoffTurnCompletion(params: {
    book: SpinoffBook;
    turns: SpinoffTurn[];
    userActionText: string;
    chapterPrompt?: string;
    signal?: AbortSignal;
    onStreamDelta?: (previewContent: string) => void;
}): Promise<{ content: string; thinking?: string }> {
    const { book, turns, userActionText, chapterPrompt, signal, onStreamDelta } = params;
    const chars = loadCharacters();
    const character = chars.find(c => c.id === book.characterId);
    if (!character) throw new Error("未找到该角色档案");

    // 借用该角色的会话壳组装完整人设 + 记忆（核心记忆、长期记忆、近期事件），但结果绝不写回聊天室或记忆库
    const baseSession: ChatSession = createOrGetSession(character.id);
    const studio = loadSpinoffCharStudio(character.id);

    // 把本书历史转成临时 history 传入组装器
    const history: ChatMessage[] = [];
    for (const t of turns) {
        if (t.userContent.trim()) {
            history.push({
                id: `${t.id}_u`,
                sessionId: `spinoff_${book.id}`,
                role: "user",
                content: t.userContent,
                status: "sent",
                createdAt: t.createdAt,
            });
        }
        if (t.assistantContent.trim()) {
            history.push({
                id: `${t.id}_a`,
                sessionId: `spinoff_${book.id}`,
                role: "assistant",
                content: `<content>\n${t.assistantContent}\n</content>`,
                status: "sent",
                createdAt: t.createdAt,
            });
        }
    }

    const effectiveUserPrompt = [
        turns.length === 0 && book.openingPrompt?.trim() ? `【本卷番外开篇设定】\n${book.openingPrompt.trim()}` : "",
        chapterPrompt?.trim() ? `【本幕推进指令】\n${chapterPrompt.trim()}` : "",
        userActionText.trim(),
    ].filter(Boolean).join("\n\n") || "请按照当前番外情境自然开启或继续推进剧情。";

    history.push({
        id: `spinoff_pending_${Date.now()}`,
        sessionId: `spinoff_${book.id}`,
        role: "user",
        content: effectiveUserPrompt,
        status: "sent",
        createdAt: new Date().toISOString(),
    });

    const built = await buildChatPromptMessages(baseSession, history, {
        appTags: ["chat", "offline"],
        toolsAllowed: false,
        promptProfile: studio.useIndependentWorldBooks ? { enableWorldBooks: false } : undefined,
    });

    const { llmMessages, config, preset, regexes, userIdentity } = built;

    // 若开启了番外独立世界书，则单独拼入被勾选的世界书条目
    if (studio.useIndependentWorldBooks && studio.worldBookIds?.length) {
        const allWbs = loadWorldBooks();
        const overrides = studio.worldBookEntryOverrides || {};
        const wbSnippets: string[] = [];
        for (const wbId of studio.worldBookIds) {
            const wb = allWbs.find(w => w.id === wbId);
            if (!wb) continue;
            for (const entry of wb.entries) {
                const key = `${wb.id}:${entry.uid}`;
                const enabled = key in overrides ? overrides[key] : !entry.disable;
                if (!enabled || !entry.content.trim()) continue;
                wbSnippets.push(entry.content.trim());
            }
        }
        if (wbSnippets.length > 0) {
            llmMessages.unshift({
                role: "system",
                content: `<spinoff_worldbook>\n${wbSnippets.join("\n\n")}\n</spinoff_worldbook>`,
            });
        }
    } else {
        void applyWorldBookEntryOverrides;
    }

    // 注入「纯粹番外规则 + 文风 + 思维链」
    const cotTag = (studio.cotTag || "thinking").trim().replace(/[^a-zA-Z0-9_-]/g, "") || "thinking";
    const systemBlocks: string[] = [
        [
            "### 【平行番外剧场规则】",
            `当前正在进行角色「${character.name}」与「${userIdentity?.name || "用户"}」的独立番外剧场《${book.title}》。`,
            "- 你可以自然参考你们过往的记忆、默契、性格细节与人物关系，使互动鲜活真实；",
            "- 本场为纯粹番外，请沉浸式使用小说/剧场叙事描写动作、神态、环境氛围与对白，不要发手机气泡格式指令，也无需输出 <summary> 记忆总结标签。",
        ].join("\n"),
    ];

    if (studio.styleEnabled && studio.stylePrompt?.trim()) {
        systemBlocks.push(`### 【番外文风要求】\n${studio.stylePrompt.trim()}`);
    }
    if (studio.cotEnabled) {
        const cotBody = studio.cotPrompt?.trim() || DEFAULT_COT_PRESETS[0].content;
        systemBlocks.push(
            `### 【番外折叠思维链要求】\n${cotBody}\n请先用 <${cotTag}>...</${cotTag}> 包裹你的完整推演思考，闭合 </${cotTag}> 后再输出番外正文（可用 <content>...</content> 包裹或直接写正文）。`,
        );
    }

    llmMessages.push({
        role: "system",
        content: systemBlocks.join("\n\n"),
    });

    const meta = { characterName: character.name, userName: userIdentity?.name };
    let reasoning = "";
    let rawOutput = "";

    if (studio.streamEnabled !== false && onStreamDelta) {
        let accum = "";
        const streamRes = await sendLLMStreamRequest(
            config,
            preset,
            llmMessages,
            regexes,
            meta,
            { appId: "chat", appTags: ["chat", "offline"], signal },
            {
                onDelta: (delta) => {
                    accum += delta;
                    const cleaned = stripOnlineThinkingTag(
                        stripOnlineThinkingTag(accum, cotTag),
                        "thinking",
                    )
                        .replace(/<summary>[\s\S]*?<\/summary>/gi, "")
                        .replace(/<\/?(?:content|summary|thinking|thought|think)>/gi, "")
                        .trim();
                    onStreamDelta(cleaned);
                },
                onReasoningDelta: (r) => { reasoning += r; },
            },
        );
        rawOutput = streamRes.content;
    } else {
        rawOutput = await sendLLMRequest(config, preset, llmMessages, regexes, meta, {
            appId: "chat",
            appTags: ["chat", "offline"],
            signal,
            onReasoning: (r) => { reasoning = r; },
        });
    }

    rawOutput = stripPresetTexts(rawOutput, preset);
    const summaryTag = preset?.story_summary_tag?.trim() || "summary";
    const parsed = parseOfflineResponse(rawOutput, summaryTag);
    const tagThinking = extractThinkingTag(rawOutput, cotTag) || extractThinkingTag(rawOutput, "thinking");
    let finalContent = parsed.content || rawOutput;
    for (const t of new Set([cotTag, "thinking", "thought", "think", summaryTag, "summary"])) {
        finalContent = stripOnlineThinkingTag(finalContent, t);
    }
    finalContent = finalContent.replace(/<\/?content>/gi, "").trim();

    // 注意：这里刻意不调用 incrementEventCounter / maybeRunSummarization / appendChatOfflineTurn，
    // 从而严格保证番外不会污染线上聊天和线下主线的记忆总结！
    return {
        content: finalContent,
        thinking: tagThinking || reasoning.trim() || undefined,
    };
}
