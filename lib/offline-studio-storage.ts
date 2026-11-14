// lib/offline-studio-storage.ts
// 独立「线下」应用专属增强存储：
// 1. 线下独立世界书选择 + 单条目开关覆写（与线上/悬浮球完全隔离，互不串扰）
// 2. 自定义思维链（CoT）指令与预设库（开启后强制模型输出折叠思维链 <thinking>...</thinking>）
// 3. 自定义叙事文风指令与预设库

import { kvGet, kvSet, registerKvMigration, registerDynamicPrefix } from "./kv-db";
import type { WorldBookConfig } from "./settings-types";

const OFFLINE_COT_PRESETS_KEY = "ai_phone_offline_cot_presets_v1";
const OFFLINE_STYLE_PRESETS_KEY = "ai_phone_offline_style_presets_v1";
const OFFLINE_SESSION_CONFIG_PREFIX = "ai_phone_offline_session_cfg_v1:";

registerKvMigration(OFFLINE_COT_PRESETS_KEY);
registerKvMigration(OFFLINE_STYLE_PRESETS_KEY);
registerDynamicPrefix(OFFLINE_SESSION_CONFIG_PREFIX);

export const OFFLINE_STUDIO_UPDATED_EVENT = "offline-studio-config-updated";

export type OfflineTextPreset = {
    id: string;
    name: string;
    content: string;
    tag?: string; // 仅思维链预设可选指定标签名，默认 thinking
    builtIn?: boolean;
    updatedAt: string;
};

export type OfflineSessionStudioConfig = {
    /** true = 线下模式使用独立的自定义世界书集合（不改动线上/全局绑定）；false = 沿用角色原绑定 */
    useIndependentWorldBooks?: boolean;
    /** 线下独立勾选的世界书 ID 列表 */
    worldBookIds?: string[];
    /** 线下独立的世界书单条目开关覆写：key 为 `${worldBookId}:${entryUid}`，true=启用，false=关闭 */
    worldBookEntryOverrides?: Record<string, boolean>;

    /** 是否启用线下自定义折叠思维链 */
    cotEnabled?: boolean;
    /** 当前选中的思维链预设 ID */
    cotPresetId?: string;
    /** 当前会话自定义思维链提示词正文 */
    cotPrompt?: string;
    /** 思维链包裹标签（默认 thinking） */
    cotTag?: string;

    /** 是否启用线下自定义文风指导 */
    styleEnabled?: boolean;
    /** 当前选中的文风预设 ID */
    stylePresetId?: string;
    /** 当前会话自定义文风提示词正文 */
    stylePrompt?: string;
};

export const DEFAULT_COT_PRESETS: OfflineTextPreset[] = [
    {
        id: "cot_builtin_immersive",
        name: "深度心理与场景推演",
        tag: "thinking",
        builtIn: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: [
            "在正式写下线下剧情正文前，请先在 <thinking>...</thinking> 标签内进行角色心理与在场细节推演：",
            "1. 梳理当前物理空间、距离感、光线氛围与上一幕留下的动作衔接；",
            "2. 剖析角色此刻未说出口的潜台词、微表情与情绪暗流，严禁 OOC 或复读用户的动作台词；",
            "3. 规划本轮自然推进的互动节奏（留出让用户回应的余地，不替用户说话或做决定）。",
            "推演结束后闭合 </thinking>，再输出正式剧情。",
        ].join("\n"),
    },
    {
        id: "cot_builtin_tension",
        name: "张力与潜台词拉扯",
        tag: "thinking",
        builtIn: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: [
            "请在正式回复前使用 <thinking>...</thinking> 进行简练的戏剧张力分析：",
            "- 表面态度 vs 真实渴望：角色嘴上会怎么说，身体细节（视线、呼吸、指尖动作）又会泄露什么？",
            "- 感官锚点：挑选 1~2 个具体的触觉、气味或环境声响切入画面，避免空洞抒情。",
        ].join("\n"),
    },
];

export const DEFAULT_STYLE_PRESETS: OfflineTextPreset[] = [
    {
        id: "style_builtin_cinema",
        name: "电影长镜头感",
        builtIn: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: "采用克制、细腻的电影镜头语言叙事：多用具体的光影、动作停顿、环境声响与肢体细节烘托气氛，少用直白廉价的形容词堆砌；对白自然贴合口语呼吸感，不写网文套话。",
    },
    {
        id: "style_builtin_literary",
        name: "温柔日常散文感",
        builtIn: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: "文风温润松弛、富有生活实感，注重两人相处时的微小默契、体温、眼神交汇与日常器物细节，节奏舒缓自然，像翻开一页私密手记。",
    },
    {
        id: "style_builtin_noir",
        name: "冷峻暗调悬疑感",
        builtIn: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
        content: "短句为主，节奏利落冷峻，强调空气中的紧绷感、潮湿夜色与人物之间危险的试探，点到即止，留白有余韵。",
    },
];

function emitUpdated(sessionId?: string) {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(OFFLINE_STUDIO_UPDATED_EVENT, { detail: { sessionId } }));
    }
}

function makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── 预设库读写（思维链 / 文风） ──

function loadPresetList(key: string, defaults: OfflineTextPreset[]): OfflineTextPreset[] {
    if (typeof window === "undefined") return defaults;
    try {
        const raw = kvGet(key);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return defaults;
        return parsed;
    } catch {
        return defaults;
    }
}

export function loadOfflineCotPresets(): OfflineTextPreset[] {
    return loadPresetList(OFFLINE_COT_PRESETS_KEY, DEFAULT_COT_PRESETS);
}

export function saveOfflineCotPresets(presets: OfflineTextPreset[]): void {
    kvSet(OFFLINE_COT_PRESETS_KEY, JSON.stringify(presets));
    emitUpdated();
}

export function upsertOfflineCotPreset(input: { id?: string; name: string; content: string; tag?: string }): OfflineTextPreset {
    const list = loadOfflineCotPresets();
    const now = new Date().toISOString();
    const cleanName = input.name.trim() || "未命名思维链预设";
    const cleanTag = (input.tag || "thinking").trim().replace(/[^a-zA-Z0-9_-]/g, "") || "thinking";
    if (input.id) {
        const idx = list.findIndex(item => item.id === input.id);
        if (idx >= 0) {
            const updated: OfflineTextPreset = {
                ...list[idx],
                name: cleanName,
                content: input.content,
                tag: cleanTag,
                builtIn: false,
                updatedAt: now,
            };
            const next = [...list];
            next[idx] = updated;
            saveOfflineCotPresets(next);
            return updated;
        }
    }
    const created: OfflineTextPreset = {
        id: makeId("cot"),
        name: cleanName,
        content: input.content,
        tag: cleanTag,
        updatedAt: now,
    };
    saveOfflineCotPresets([created, ...list]);
    return created;
}

export function deleteOfflineCotPreset(id: string): void {
    const next = loadOfflineCotPresets().filter(item => item.id !== id);
    saveOfflineCotPresets(next.length > 0 ? next : DEFAULT_COT_PRESETS);
}

export function loadOfflineStylePresets(): OfflineTextPreset[] {
    return loadPresetList(OFFLINE_STYLE_PRESETS_KEY, DEFAULT_STYLE_PRESETS);
}

export function saveOfflineStylePresets(presets: OfflineTextPreset[]): void {
    kvSet(OFFLINE_STYLE_PRESETS_KEY, JSON.stringify(presets));
    emitUpdated();
}

export function upsertOfflineStylePreset(input: { id?: string; name: string; content: string }): OfflineTextPreset {
    const list = loadOfflineStylePresets();
    const now = new Date().toISOString();
    const cleanName = input.name.trim() || "未命名文风预设";
    if (input.id) {
        const idx = list.findIndex(item => item.id === input.id);
        if (idx >= 0) {
            const updated: OfflineTextPreset = {
                ...list[idx],
                name: cleanName,
                content: input.content,
                builtIn: false,
                updatedAt: now,
            };
            const next = [...list];
            next[idx] = updated;
            saveOfflineStylePresets(next);
            return updated;
        }
    }
    const created: OfflineTextPreset = {
        id: makeId("style"),
        name: cleanName,
        content: input.content,
        updatedAt: now,
    };
    saveOfflineStylePresets([created, ...list]);
    return created;
}

export function deleteOfflineStylePreset(id: string): void {
    const next = loadOfflineStylePresets().filter(item => item.id !== id);
    saveOfflineStylePresets(next.length > 0 ? next : DEFAULT_STYLE_PRESETS);
}

// ── 会话级线下工作室配置 ──

export function loadOfflineSessionConfig(sessionId: string): OfflineSessionStudioConfig {
    if (!sessionId || typeof window === "undefined") return {};
    try {
        const raw = kvGet(OFFLINE_SESSION_CONFIG_PREFIX + sessionId);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as OfflineSessionStudioConfig) : {};
    } catch {
        return {};
    }
}

export function saveOfflineSessionConfig(sessionId: string, config: OfflineSessionStudioConfig): void {
    if (!sessionId || typeof window === "undefined") return;
    kvSet(OFFLINE_SESSION_CONFIG_PREFIX + sessionId, JSON.stringify(config));
    emitUpdated(sessionId);
}

/** 根据线下独立配置组装本会话的世界书列表（未开启独立模式时返回 null，交由原绑定处理） */
export function resolveOfflineStudioWorldBooks(
    sessionId: string,
    allWorldBooks: WorldBookConfig[],
): WorldBookConfig[] | null {
    const cfg = loadOfflineSessionConfig(sessionId);
    if (!cfg.useIndependentWorldBooks) return null;
    const ids = cfg.worldBookIds || [];
    const overrides = cfg.worldBookEntryOverrides || {};
    return ids
        .map(id => allWorldBooks.find(wb => wb.id === id))
        .filter((wb): wb is WorldBookConfig => Boolean(wb))
        .map(wb => ({
            ...wb,
            entries: wb.entries.map(entry => {
                const key = `${wb.id}:${entry.uid}`;
                if (!(key in overrides)) return entry;
                return { ...entry, disable: !overrides[key] };
            }),
        }));
}

/** 构造注入到线下提示词末尾的【自定义文风 + 自定义折叠思维链】系统指令 */
export function buildOfflineStudioSystemPrompt(sessionId: string): {
    systemInstruction: string;
    forceThinkingTag?: string;
} {
    const cfg = loadOfflineSessionConfig(sessionId);
    const blocks: string[] = [];
    let forceThinkingTag: string | undefined;

    if (cfg.styleEnabled && cfg.stylePrompt?.trim()) {
        blocks.push(`### 【线下叙事文风要求】\n${cfg.stylePrompt.trim()}`);
    }

    if (cfg.cotEnabled) {
        const tag = (cfg.cotTag || "thinking").trim().replace(/[^a-zA-Z0-9_-]/g, "") || "thinking";
        forceThinkingTag = tag;
        const cotBody = cfg.cotPrompt?.trim() || DEFAULT_COT_PRESETS[0].content;
        blocks.push(
            `### 【线下思维链推演要求】\n${cotBody}\n（注意：请务必将你的完整思考与推演过程包裹在 <${tag}>...</${tag}> 标签内放在最开头，闭合 </${tag}> 后再输出正式剧情正文与摘要标签。）`,
        );
    }

    return {
        systemInstruction: blocks.join("\n\n"),
        forceThinkingTag,
    };
}
