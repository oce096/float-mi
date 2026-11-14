"use client";

import { useState, useEffect, useMemo } from "react";
import {
    BookOpen,
    Brain,
    Check,
    ChevronDown,
    ChevronLeft,
    Cpu,
    Feather,
    Loader2,
    MapPin,
    Palette,
    Plus,
    Save,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    User,
    Users,
    X,
} from "lucide-react";
import {
    hydrateChatStorage,
    loadChatSessions,
    createOrGetSession,
    CHAT_APP_SETTINGS_UPDATED_EVENT,
    loadChatAppSettings,
    saveChatAppSettings,
    type ChatSession,
} from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import {
    resolveUserIdentity,
    loadUserIdentities,
    loadBindingConfig,
    saveBindingConfig,
    loadWorldBooks,
    loadApiConfigs,
    loadPresets,
    loadRegexes,
    resolveBinding,
} from "@/lib/settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "@/lib/settings-types";
import { getUserIdentityDisplayName, type UserIdentity } from "@/components/settings/user-identity";
import { getLastChatOfflineTurn, getChatOfflineTurnPreview, loadChatOfflineTurns } from "@/lib/chat-offline-storage";
import { formatChatUiTime } from "@/lib/chat-time";
import { PageShell } from "@/components/ui/page-shell";
import { ChatRoom } from "@/components/chat/chat-room";
import { ChatFallbackAvatar } from "@/components/chat/chat-fallback-avatar";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { CHAT_APP_CSS_EXAMPLE } from "@/lib/css-examples";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import { Toggle, Input } from "@/components/ui/form";
import { runSummarizationPipeline } from "@/lib/memory-summarizer";
import {
    loadOfflineSessionConfig,
    saveOfflineSessionConfig,
    loadOfflineCotPresets,
    upsertOfflineCotPreset,
    deleteOfflineCotPreset,
    loadOfflineStylePresets,
    upsertOfflineStylePreset,
    deleteOfflineStylePreset,
    DEFAULT_COT_PRESETS,
    DEFAULT_STYLE_PRESETS,
    OFFLINE_STUDIO_UPDATED_EVENT,
    type OfflineSessionStudioConfig,
    type OfflineTextPreset,
} from "@/lib/offline-studio-storage";

const OFFLINE_APP_CSS_KEY = "offline-app-custom-css";

function doesSessionMatchIdentity(session: ChatSession, activeIdentityId?: string | null): boolean {
    if (!activeIdentityId) return true;
    if (session.userIdentityId) return session.userIdentityId === activeIdentityId;
    if (session.isGroup) {
        const memberIds = session.participantIds || [];
        return memberIds.length === 0 || memberIds.some(cid => resolveUserIdentity(cid, "chat")?.id === activeIdentityId);
    }
    return resolveUserIdentity(session.contactId, "chat")?.id === activeIdentityId;
}

/**
 * 线下会话内的「场记悬浮球」与控制台：
 * - 独立世界书与单条条目开关（与线上完全分开）
 * - 自定义折叠思维链 + 预设保存/切换
 * - 自定义叙事文风 + 预设保存/切换
 * - 一键触发线上同款长期记忆总结
 */
export function OfflineStudioDrawer({
    session,
    character,
    onClose,
    onToast,
}: {
    session: ChatSession;
    character: Character | null;
    onClose: () => void;
    onToast: (msg: string) => void;
}) {
    const [studioTab, setStudioTab] = useState<"engine" | "worldbook" | "cot" | "style" | "summary">("engine");
    const [cfg, setCfg] = useState<OfflineSessionStudioConfig>(() => loadOfflineSessionConfig(session.id));
    const [apiConfigs] = useState<ApiConfig[]>(() => loadApiConfigs());
    const [presets] = useState<PresetConfig[]>(() => loadPresets());
    const [regexes] = useState<RegexConfig[]>(() => loadRegexes());
    const [worldBooks] = useState<WorldBookConfig[]>(() => loadWorldBooks());
    const [expandedBookIds, setExpandedBookIds] = useState<Set<string>>(() => new Set());

    // 思维链预设状态
    const [cotPresets, setCotPresets] = useState<OfflineTextPreset[]>(() => loadOfflineCotPresets());
    const [cotNameDraft, setCotNameDraft] = useState("");

    // 文风预设状态
    const [stylePresets, setStylePresets] = useState<OfflineTextPreset[]>(() => loadOfflineStylePresets());
    const [styleNameDraft, setStyleNameDraft] = useState("");

    // 记忆总结状态
    const [summarizing, setSummarizing] = useState(false);
    const [summaryResult, setSummaryResult] = useState<string | null>(null);

    const updateCfg = (patch: Partial<OfflineSessionStudioConfig>) => {
        const next = { ...cfg, ...patch };
        setCfg(next);
        saveOfflineSessionConfig(session.id, next);
    };

    // 切换开启独立世界书时，首次默认把角色原绑定的世界书拷过来当初始勾选，免去从零勾起
    const toggleIndependentWb = (enabled: boolean) => {
        if (enabled && (!cfg.worldBookIds || cfg.worldBookIds.length === 0)) {
            const boundSlot = resolveBinding(
                loadBindingConfig(),
                session.isGroup ? session.participantIds?.[0] : session.contactId,
                session.isGroup ? "group_chat" : "chat",
            );
            updateCfg({
                useIndependentWorldBooks: true,
                worldBookIds: boundSlot.worldBookIds ? [...boundSlot.worldBookIds] : [],
            });
            return;
        }
        updateCfg({ useIndependentWorldBooks: enabled });
    };

    const selectedWbIds = cfg.worldBookIds || [];
    const entryOverrides = cfg.worldBookEntryOverrides || {};

    const toggleWorldBook = (wbId: string) => {
        const next = selectedWbIds.includes(wbId)
            ? selectedWbIds.filter(id => id !== wbId)
            : [...selectedWbIds, wbId];
        updateCfg({ useIndependentWorldBooks: true, worldBookIds: next });
    };

    const toggleEntryOverride = (wbId: string, entryUid: string, defaultEnabled: boolean) => {
        const key = `${wbId}:${entryUid}`;
        const currentEffective = key in entryOverrides ? entryOverrides[key] : defaultEnabled;
        const nextMap = { ...entryOverrides, [key]: !currentEffective };
        updateCfg({ useIndependentWorldBooks: true, worldBookEntryOverrides: nextMap });
    };

    const handleRunSummary = async (force: boolean) => {
        const targetIds = session.isGroup ? (session.participantIds || []) : [session.contactId];
        if (targetIds.length === 0) return;
        setSummarizing(true);
        setSummaryResult(null);
        try {
            const chars = loadCharacters();
            const messages: string[] = [];
            for (const cid of targetIds) {
                const c = chars.find(item => item.id === cid);
                if (!c) continue;
                const res = await runSummarizationPipeline(c.id, c.name, { force });
                messages.push(`${c.name}：${res.success ? "已生成长期记忆总结并写入记忆库" : (res.error || "无需总结")}`);
            }
            const msg = messages.join("；");
            setSummaryResult(msg);
            onToast(msg);
        } catch (err: any) {
            setSummaryResult(`总结失败：${err?.message || String(err)}`);
        } finally {
            setSummarizing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[10050] flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center" onClick={onClose}>
            <div
                className="flex max-h-[84vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-[var(--c-page-body-bg)] text-[var(--c-text)] shadow-2xl sm:rounded-3xl border border-black/10"
                onClick={e => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between px-5 pt-4 pb-2.5 border-b border-black/5">
                    <div className="flex flex-col">
                        <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--c-icon)] uppercase">OFFLINE STUDIO</span>
                        <span className="ts-16 font-bold text-[var(--c-text-title)]">
                            线下场记台 · {session.isGroup ? (session.groupName || "群聊") : (character?.name || "角色")}
                        </span>
                    </div>
                    <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-[var(--c-text)]">
                        <X size={16} />
                    </button>
                </div>

                {/* 分栏导航 */}
                <div className="grid grid-cols-5 gap-1 px-3 py-2.5 bg-[var(--c-card)]/60 border-b border-black/5">
                    {([
                        {
                            id: "engine",
                            label: "模型预设",
                            icon: Cpu,
                            activeDot: Boolean(cfg.apiOverride?.enabled || cfg.presetId || (cfg.regexIds && cfg.regexIds.length > 0)),
                        },
                        { id: "worldbook", label: "世界书", icon: BookOpen, activeDot: Boolean(cfg.useIndependentWorldBooks) },
                        { id: "cot", label: "思维链", icon: Brain, activeDot: Boolean(cfg.cotEnabled) },
                        { id: "style", label: "文风", icon: Feather, activeDot: Boolean(cfg.styleEnabled) },
                        {
                            id: "summary",
                            label: "记忆总结",
                            icon: Sparkles,
                            activeDot: cfg.autoSummaryEnabled === false || Boolean(cfg.autoSummaryTurnInterval && cfg.autoSummaryTurnInterval > 0),
                        },
                    ] as const).map(item => {
                        const Icon = item.icon;
                        const active = studioTab === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setStudioTab(item.id)}
                                className={`relative flex flex-col items-center justify-center gap-1 py-2 rounded-xl text-[10.5px] font-semibold transition-all ${
                                    active ? "bg-black text-white shadow-sm" : "bg-[var(--c-input)] text-[var(--c-text)] opacity-80"
                                }`}
                            >
                                <Icon size={14} />
                                <span>{item.label}</span>
                                {item.activeDot && (
                                    <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-emerald-500"}`} />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* 主体内容 */}
                <div className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-3.5">
                    {studioTab === "engine" && (
                        <>
                            {/* 流式三档调节 */}
                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">线下流式输出模式</span>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {([
                                        { id: "auto", label: "智能自适应", desc: "优先流式·自动回退" },
                                        { id: "stream", label: "强制流式", desc: "逐字实时展开" },
                                        { id: "non_stream", label: "非流式", desc: "整段生成后返回" },
                                    ] as const).map(opt => {
                                        const active = (cfg.streamMode || "auto") === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => updateCfg({ streamMode: opt.id })}
                                                className={`rounded-xl px-2 py-2 flex flex-col items-center text-center transition-all border ${
                                                    active ? "bg-black text-white border-black" : "bg-[var(--c-input)] text-[var(--c-text)] border-transparent"
                                                }`}
                                            >
                                                <span className="ts-12 font-bold">{opt.label}</span>
                                                <span className={`text-[9.5px] mt-0.5 ${active ? "text-white/75" : "text-[var(--c-icon)]"}`}>{opt.desc}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 会话级独立 API / 模型覆盖 */}
                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col pr-3">
                                        <span className="ts-13 font-bold text-[var(--c-text-title)]">本场独立 API / 模型覆盖</span>
                                        <span className="ts-11 text-[var(--c-icon)]">仅对当前角色线下生效，不改动线上聊天与全局设置</span>
                                    </div>
                                    <Toggle
                                        checked={Boolean(cfg.apiOverride?.enabled)}
                                        onChange={enabled => updateCfg({
                                            apiOverride: { ...(cfg.apiOverride || {}), enabled },
                                        })}
                                    />
                                </div>

                                {cfg.apiOverride?.enabled && (
                                    <div className="flex flex-col gap-2 pt-1 border-t border-black/5">
                                        <div className="flex flex-col gap-1">
                                            <span className="ts-11 text-[var(--c-icon)]">引用基底 API 方案（可选）</span>
                                            <select
                                                value={cfg.apiOverride?.sourceApiConfigId || ""}
                                                onChange={e => updateCfg({
                                                    apiOverride: {
                                                        ...(cfg.apiOverride || { enabled: true }),
                                                        sourceApiConfigId: e.target.value || undefined,
                                                    },
                                                })}
                                                className="ui-select ts-12"
                                            >
                                                <option value="">— 继承角色默认绑定的 API —</option>
                                                {apiConfigs.map(ac => (
                                                    <option key={ac.id} value={ac.id}>
                                                        {ac.name || ac.provider} ({ac.defaultModel})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <span className="ts-11 text-[var(--c-icon)]">单独指定模型名称（留空则沿用基底方案模型）</span>
                                            <Input
                                                type="text"
                                                value={cfg.apiOverride?.model || ""}
                                                onChange={e => updateCfg({
                                                    apiOverride: { ...(cfg.apiOverride || { enabled: true }), model: e.target.value },
                                                })}
                                                placeholder="例如：claude-3-7-sonnet / deepseek-reasoner"
                                                className="font-mono ts-12"
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <span className="ts-11 text-[var(--c-icon)]">单独覆盖 Base URL（选填）</span>
                                            <Input
                                                type="text"
                                                value={cfg.apiOverride?.baseUrl ?? ""}
                                                onChange={e => updateCfg({
                                                    apiOverride: { ...(cfg.apiOverride || { enabled: true }), baseUrl: e.target.value || undefined },
                                                })}
                                                placeholder="留空沿用基底 Base URL"
                                                className="font-mono ts-12"
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <span className="ts-11 text-[var(--c-icon)]">单独覆盖 API Key（选填）</span>
                                            <Input
                                                type="password"
                                                value={cfg.apiOverride?.apiKey || ""}
                                                onChange={e => updateCfg({
                                                    apiOverride: { ...(cfg.apiOverride || { enabled: true }), apiKey: e.target.value },
                                                })}
                                                placeholder="留空沿用基底 API Key"
                                                className="font-mono ts-12"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 线下专属预设选择 */}
                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2">
                                <div className="flex flex-col">
                                    <span className="ts-13 font-bold text-[var(--c-text-title)]">线下专用预设（含酒馆导入的线下预设）</span>
                                    <span className="ts-11 text-[var(--c-icon)]">
                                        可直接选用「线下专属」分组预设，随包绑定的正则会自动对本场生效，且绝不污染线上
                                    </span>
                                </div>
                                <select
                                    value={cfg.presetId || ""}
                                    onChange={e => updateCfg({ presetId: e.target.value || undefined })}
                                    className="ui-select ts-12"
                                >
                                    <option value="">— 跟随角色/全局绑定预设 —</option>
                                    {presets.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.presetGroup === "offline" ? `[线下专属] ${p.name}` : p.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* 线下额外正则组勾选 */}
                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">本场附加正则组（支持「线下专属」正则）</span>
                                {regexes.length === 0 ? (
                                    <span className="ts-11 text-[var(--c-icon)]">暂无可用正则组</span>
                                ) : (
                                    <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
                                        {regexes.map(rx => {
                                            const selectedRxIds = cfg.regexIds || [];
                                            const checked = selectedRxIds.includes(rx.id);
                                            return (
                                                <button
                                                    key={rx.id}
                                                    type="button"
                                                    onClick={() => {
                                                        const next = checked
                                                            ? selectedRxIds.filter(id => id !== rx.id)
                                                            : [...selectedRxIds, rx.id];
                                                        updateCfg({ regexIds: next });
                                                    }}
                                                    className="flex items-center justify-between gap-2 rounded-xl bg-[var(--c-input)] px-3 py-2 text-left"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${checked ? "bg-black border-black text-white" : "border-black/20"}`}>
                                                            {checked && <Check size={11} />}
                                                        </span>
                                                        <span className="ts-12 font-medium text-[var(--c-text-title)] truncate">{rx.name}</span>
                                                    </div>
                                                    {rx.regexGroup === "offline" && (
                                                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 text-[10px] font-bold shrink-0">
                                                            线下专属
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {studioTab === "worldbook" && (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5">
                                <div className="flex flex-col gap-0.5 pr-3">
                                    <span className="ts-14 font-bold text-[var(--c-text-title)]">线下独立世界书配置</span>
                                    <span className="ts-11 text-[var(--c-icon)]">
                                        开启后仅对本场线下生效，与线上聊天/全局悬浮球完全隔离互不影响
                                    </span>
                                </div>
                                <Toggle checked={Boolean(cfg.useIndependentWorldBooks)} onChange={toggleIndependentWb} />
                            </div>

                            {worldBooks.length === 0 ? (
                                <div className="py-8 text-center ts-12 text-[var(--c-icon)]">尚未创建任何世界书</div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {worldBooks.map(wb => {
                                        const checked = selectedWbIds.includes(wb.id);
                                        const expanded = expandedBookIds.has(wb.id);
                                        return (
                                            <div key={wb.id} className="rounded-2xl bg-[var(--c-card)] border border-black/5 overflow-hidden">
                                                <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleWorldBook(wb.id)}
                                                        className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                                                    >
                                                        <span className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all shrink-0 ${checked ? "bg-black border-black text-white" : "border-black/20 bg-transparent"}`}>
                                                            {checked && <Check size={13} />}
                                                        </span>
                                                        <div className="flex flex-col min-w-0 flex-1">
                                                            <span className="ts-13 font-bold text-[var(--c-text-title)] truncate">{wb.name}</span>
                                                            <span className="ts-10 text-[var(--c-icon)]">{wb.entries.length} 个条目</span>
                                                        </div>
                                                    </button>
                                                    {wb.entries.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setExpandedBookIds(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(wb.id)) next.delete(wb.id);
                                                                    else next.add(wb.id);
                                                                    return next;
                                                                });
                                                            }}
                                                            className="px-2 py-1 rounded-lg bg-[var(--c-input)] ts-11 text-[var(--c-text)] flex items-center gap-1 shrink-0"
                                                        >
                                                            <span>条目</span>
                                                            <ChevronDown size={13} className={expanded ? "rotate-180 transition-transform" : "transition-transform"} />
                                                        </button>
                                                    )}
                                                </div>

                                                {expanded && wb.entries.length > 0 && (
                                                    <div className="border-t border-black/5 bg-[var(--c-input)]/50 px-3 py-2 flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                                                        {wb.entries.map(entry => {
                                                            const key = `${wb.id}:${entry.uid}`;
                                                            const hasOverride = key in entryOverrides;
                                                            const effectiveOn = hasOverride ? entryOverrides[key] : !entry.disable;
                                                            return (
                                                                <div key={entry.uid} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--c-card)] px-2.5 py-1.5">
                                                                    <div className="flex flex-col min-w-0 flex-1">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0 ${entry.constant ? "bg-blue-500/15 text-blue-600" : "bg-amber-500/15 text-amber-600"}`}>
                                                                                {entry.constant ? "常驻" : "关键词"}
                                                                            </span>
                                                                            <span className="ts-12 font-medium text-[var(--c-text-title)] truncate">
                                                                                {entry.comment || entry.key || "未命名条目"}
                                                                            </span>
                                                                        </div>
                                                                        {hasOverride && (
                                                                            <span className="text-[10px] text-[var(--c-icon)]">
                                                                                线下已单独{effectiveOn ? "开启" : "关闭"}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <Toggle
                                                                        checked={effectiveOn}
                                                                        onChange={() => toggleEntryOverride(wb.id, entry.uid, !entry.disable)}
                                                                    />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}

                    {studioTab === "cot" && (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5">
                                <div className="flex flex-col gap-0.5 pr-3">
                                    <span className="ts-14 font-bold text-[var(--c-text-title)]">启用折叠思维链推演</span>
                                    <span className="ts-11 text-[var(--c-icon)]">
                                        每次回复前按你的思维链指令推演心理与细节，并在角色回复顶部生成可点击展开的折叠思考条
                                    </span>
                                </div>
                                <Toggle
                                    checked={Boolean(cfg.cotEnabled)}
                                    onChange={enabled => {
                                        updateCfg({
                                            cotEnabled: enabled,
                                            cotPrompt: cfg.cotPrompt || DEFAULT_COT_PRESETS[0].content,
                                            cotTag: cfg.cotTag || "thinking",
                                        });
                                    }}
                                />
                            </div>

                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="ts-12 font-bold text-[var(--c-text-title)]">思维链预设库</span>
                                    <span className="ts-10 text-[var(--c-icon)]">点击切换 · 可保存新预设</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {cotPresets.map(p => {
                                        const active = cfg.cotPresetId === p.id;
                                        return (
                                            <div key={p.id} className="inline-flex items-center rounded-full overflow-hidden border border-black/10">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        updateCfg({
                                                            cotEnabled: true,
                                                            cotPresetId: p.id,
                                                            cotPrompt: p.content,
                                                            cotTag: p.tag || "thinking",
                                                        });
                                                        setCotNameDraft(p.name);
                                                    }}
                                                    className={`px-3 py-1 ts-11 font-medium transition-all ${active ? "bg-black text-white" : "bg-[var(--c-input)] text-[var(--c-text)]"}`}
                                                >
                                                    {p.name}
                                                </button>
                                                {!p.builtIn && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            deleteOfflineCotPreset(p.id);
                                                            setCotPresets(loadOfflineCotPresets());
                                                        }}
                                                        className="px-1.5 py-1 bg-[var(--c-input)] text-[var(--c-danger)] hover:bg-red-500/10"
                                                        title="删除预设"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                    <span className="ts-11 text-[var(--c-icon)] shrink-0">包裹标签名</span>
                                    <Input
                                        type="text"
                                        value={cfg.cotTag || "thinking"}
                                        onChange={e => updateCfg({ cotTag: e.target.value })}
                                        placeholder="thinking"
                                        className="font-mono ts-12 py-1"
                                    />
                                </div>

                                <textarea
                                    value={cfg.cotPrompt ?? DEFAULT_COT_PRESETS[0].content}
                                    onChange={e => updateCfg({ cotPrompt: e.target.value })}
                                    rows={6}
                                    placeholder="输入让角色在每次回复前思考推演的具体维度..."
                                    className="ui-textarea ts-12 leading-relaxed"
                                />

                                <div className="flex items-center gap-2 pt-1">
                                    <Input
                                        type="text"
                                        value={cotNameDraft}
                                        onChange={e => setCotNameDraft(e.target.value)}
                                        placeholder="输入预设名称以保存/覆盖..."
                                        className="flex-1 ts-12"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const name = cotNameDraft.trim() || "我的思维链";
                                            const existingSameName = cotPresets.find(x => x.name === name && !x.builtIn);
                                            const saved = upsertOfflineCotPreset({
                                                id: existingSameName?.id,
                                                name,
                                                content: cfg.cotPrompt || DEFAULT_COT_PRESETS[0].content,
                                                tag: cfg.cotTag || "thinking",
                                            });
                                            setCotPresets(loadOfflineCotPresets());
                                            updateCfg({ cotPresetId: saved.id, cotEnabled: true });
                                            onToast(`已保存思维链预设「${saved.name}」`);
                                        }}
                                        className="ui-btn ui-btn-primary px-3 py-2 rounded-xl ts-12 shrink-0 flex items-center gap-1"
                                    >
                                        <Save size={14} />
                                        保存预设
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {studioTab === "style" && (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5">
                                <div className="flex flex-col gap-0.5 pr-3">
                                    <span className="ts-14 font-bold text-[var(--c-text-title)]">启用线下专属文风</span>
                                    <span className="ts-11 text-[var(--c-icon)]">
                                        约束线下叙事的笔触、镜头感、句式节奏与对白质感，支持存为预设随时切换
                                    </span>
                                </div>
                                <Toggle
                                    checked={Boolean(cfg.styleEnabled)}
                                    onChange={enabled => {
                                        updateCfg({
                                            styleEnabled: enabled,
                                            stylePrompt: cfg.stylePrompt || DEFAULT_STYLE_PRESETS[0].content,
                                        });
                                    }}
                                />
                            </div>

                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2.5">
                                <div className="flex items-center justify-between">
                                    <span className="ts-12 font-bold text-[var(--c-text-title)]">文风预设库</span>
                                    <span className="ts-10 text-[var(--c-icon)]">点击即应用</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {stylePresets.map(p => {
                                        const active = cfg.stylePresetId === p.id;
                                        return (
                                            <div key={p.id} className="inline-flex items-center rounded-full overflow-hidden border border-black/10">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        updateCfg({
                                                            styleEnabled: true,
                                                            stylePresetId: p.id,
                                                            stylePrompt: p.content,
                                                        });
                                                        setStyleNameDraft(p.name);
                                                    }}
                                                    className={`px-3 py-1 ts-11 font-medium transition-all ${active ? "bg-black text-white" : "bg-[var(--c-input)] text-[var(--c-text)]"}`}
                                                >
                                                    {p.name}
                                                </button>
                                                {!p.builtIn && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            deleteOfflineStylePreset(p.id);
                                                            setStylePresets(loadOfflineStylePresets());
                                                        }}
                                                        className="px-1.5 py-1 bg-[var(--c-input)] text-[var(--c-danger)] hover:bg-red-500/10"
                                                        title="删除文风预设"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <textarea
                                    value={cfg.stylePrompt ?? DEFAULT_STYLE_PRESETS[0].content}
                                    onChange={e => updateCfg({ stylePrompt: e.target.value })}
                                    rows={6}
                                    placeholder="描写你想要的叙事文风（例如：冷峻克制、意识流、日系轻小说或古典电影感）..."
                                    className="ui-textarea ts-12 leading-relaxed"
                                />

                                <div className="flex items-center gap-2 pt-1">
                                    <Input
                                        type="text"
                                        value={styleNameDraft}
                                        onChange={e => setStyleNameDraft(e.target.value)}
                                        placeholder="输入文风预设名称..."
                                        className="flex-1 ts-12"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const name = styleNameDraft.trim() || "自定义文风";
                                            const existingSameName = stylePresets.find(x => x.name === name && !x.builtIn);
                                            const saved = upsertOfflineStylePreset({
                                                id: existingSameName?.id,
                                                name,
                                                content: cfg.stylePrompt || DEFAULT_STYLE_PRESETS[0].content,
                                            });
                                            setStylePresets(loadOfflineStylePresets());
                                            updateCfg({ stylePresetId: saved.id, styleEnabled: true });
                                            onToast(`已保存文风预设「${saved.name}」`);
                                        }}
                                        className="ui-btn ui-btn-primary px-3 py-2 rounded-xl ts-12 shrink-0 flex items-center gap-1"
                                    >
                                        <Save size={14} />
                                        保存预设
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {studioTab === "summary" && (
                        <>
                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col pr-3">
                                        <span className="ts-13 font-bold text-[var(--c-text-title)]">线下自动长期记忆总结</span>
                                        <span className="ts-11 text-[var(--c-icon)]">关闭后本场线下仅记录事件摘要，不自动触发长期记忆总结请求</span>
                                    </div>
                                    <Toggle
                                        checked={cfg.autoSummaryEnabled !== false}
                                        onChange={enabled => updateCfg({ autoSummaryEnabled: enabled })}
                                    />
                                </div>

                                {cfg.autoSummaryEnabled !== false && (
                                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-black/5">
                                        <div className="flex flex-col">
                                            <span className="ts-12 font-bold text-[var(--c-text-title)]">自定义自动总结轮数间隔</span>
                                            <span className="ts-10 text-[var(--c-icon)]">填 0 表示跟随系统记忆库默认阈值；填 N 表示每满 N 幕线下自动总结一次</span>
                                        </div>
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={cfg.autoSummaryTurnInterval ?? 0}
                                            onChange={e => {
                                                const val = Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0)));
                                                updateCfg({ autoSummaryTurnInterval: val || undefined });
                                            }}
                                            className="w-16 rounded-xl bg-[var(--c-input)] px-2.5 py-1.5 text-center font-mono ts-13 font-bold text-[var(--c-text-title)] outline-none"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="rounded-2xl bg-[var(--c-card)] p-4 border border-black/5 flex flex-col gap-3">
                                <div className="flex flex-col gap-1">
                                    <span className="ts-14 font-bold text-[var(--c-text-title)]">手动立即压缩总结</span>
                                    <span className="ts-12 text-[var(--c-text)] opacity-80 leading-relaxed">
                                        1. 线下每轮回复都会自动提取 <code className="px-1 py-0.5 rounded bg-black/5 font-mono">&lt;summary&gt;</code> 事件摘要进入短期记忆流。
                                        <br />
                                        2. 你也可以随时点击下方按钮，立即把最新线下与线上事件压缩总结进角色的「长期记忆库」。
                                    </span>
                                </div>

                                {summaryResult && (
                                    <div className="rounded-xl bg-[var(--c-input)] px-3 py-2.5 ts-12 text-[var(--c-text-title)]">
                                        {summaryResult}
                                    </div>
                                )}

                                <div className="flex gap-2 pt-1">
                                    <button
                                        type="button"
                                        disabled={summarizing}
                                        onClick={() => void handleRunSummary(false)}
                                        className="ui-btn ui-btn-primary flex-1 rounded-xl py-2.5 flex items-center justify-center gap-1.5"
                                    >
                                        {summarizing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                                        <span>总结新增事件</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={summarizing}
                                        onClick={() => void handleRunSummary(true)}
                                        className="ui-btn ui-btn-outline flex-1 rounded-xl py-2.5"
                                    >
                                        全量重新总结
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export function OfflineChatApp({ onClose }: { onClose: () => void }) {
    const [dbReady, setDbReady] = useState(false);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
    const [searchText, setSearchText] = useState("");
    const [tab, setTab] = useState<"recent" | "characters" | "groups">("recent");
    const [identity, setIdentity] = useState<UserIdentity | null>(null);
    const [allIdentities, setAllIdentities] = useState<UserIdentity[]>([]);
    const [showIdentityModal, setShowIdentityModal] = useState(false);
    const [filterByIdentity, setFilterByIdentity] = useState(true);
    const [showCssEditor, setShowCssEditor] = useState(false);
    const [offlineAppCss, setOfflineAppCss] = useState(() => (typeof window !== "undefined" ? kvGet(OFFLINE_APP_CSS_KEY) || "" : ""));
    const [cssDraft, setCssDraft] = useState("");
    const [showCharPicker, setShowCharPicker] = useState(false);
    const [showStudioDrawer, setShowStudioDrawer] = useState(false);
    const [toastText, setToastText] = useState<string | null>(null);
    const [studioRevision, setStudioRevision] = useState(0);

    const showToast = (msg: string) => {
        setToastText(msg);
        window.setTimeout(() => {
            setToastText(prev => (prev === msg ? null : prev));
        }, 2400);
    };

    const refreshAll = () => {
        setSessions(loadChatSessions());
        setIdentity(resolveUserIdentity());
        setAllIdentities(loadUserIdentities());
        setFilterByIdentity(loadChatAppSettings().filterByCurrentIdentity !== false);
        setOfflineAppCss(kvGet(OFFLINE_APP_CSS_KEY) || "");
    };

    useEffect(() => {
        hydrateChatStorage().then(() => {
            refreshAll();
            setDbReady(true);
        });
    }, []);

    useEffect(() => {
        const onSync = () => refreshAll();
        const onStudioSync = () => setStudioRevision(v => v + 1);
        window.addEventListener("settings-bindings-updated", onSync);
        window.addEventListener("settings-identities-updated", onSync);
        window.addEventListener("chat-messages-updated", onSync);
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, onSync);
        window.addEventListener(OFFLINE_STUDIO_UPDATED_EVENT, onStudioSync);
        return () => {
            window.removeEventListener("settings-bindings-updated", onSync);
            window.removeEventListener("settings-identities-updated", onSync);
            window.removeEventListener("chat-messages-updated", onSync);
            window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, onSync);
            window.removeEventListener(OFFLINE_STUDIO_UPDATED_EVENT, onStudioSync);
        };
    }, []);

    const characters = useMemo(() => (dbReady ? loadCharacters() : []), [dbReady, sessions]);
    const charMap = useMemo(() => new Map<string, Character>(characters.map(c => [c.id, c])), [characters]);

    const activeStudioSummary = useMemo(() => {
        void studioRevision;
        if (!activeSession) return { activeCount: 0 };
        const cfg = loadOfflineSessionConfig(activeSession.id);
        let activeCount = 0;
        if (cfg.apiOverride?.enabled) activeCount += 1;
        if (cfg.presetId) activeCount += 1;
        if (cfg.regexIds && cfg.regexIds.length > 0) activeCount += 1;
        if (cfg.useIndependentWorldBooks) activeCount += 1;
        if (cfg.cotEnabled) activeCount += 1;
        if (cfg.styleEnabled) activeCount += 1;
        return { activeCount };
    }, [activeSession, studioRevision]);

    const selectGlobalIdentity = (id: string) => {
        const cfg = loadBindingConfig();
        saveBindingConfig({
            ...cfg,
            globalDefaults: { ...cfg.globalDefaults, userIdentityId: id },
        });
        refreshAll();
        setShowIdentityModal(false);
    };

    if (!dbReady) return null;

    if (showCssEditor) {
        return (
            <div className="offline-chat-app absolute inset-0 flex flex-col overflow-hidden z-20 bg-[var(--c-page-body-bg)]">
                <PageShell title="线下全局 CSS 美化" onBack={() => setShowCssEditor(false)}>
                    <div className="p-4 flex flex-col gap-3 flex-1">
                        <div className="ts-12 text-[var(--c-text)] opacity-75">
                            自定义独立「线下」App 的样式（单会话 CSS 优先级更高，保持不变）。支持一键保存/加载/修改美化预设。
                        </div>
                        <textarea
                            value={cssDraft}
                            onChange={e => setCssDraft(e.target.value)}
                            placeholder="/* 输入线下 App 自定义 CSS... */"
                            className="ui-textarea font-mono ts-13 leading-relaxed flex-1"
                            style={{ minHeight: 280, resize: "none" }}
                            spellCheck={false}
                        />
                        <div className="flex gap-2 items-center">
                            <CSSSchemeBar target="offline_app" currentCSS={cssDraft} onLoad={setCssDraft} />
                            <button type="button" className="ui-btn ui-btn-outline flex-1" onClick={() => setCssDraft(CHAT_APP_CSS_EXAMPLE)}>示例</button>
                            <button type="button" className="ui-btn ui-btn-outline flex-1" onClick={() => setCssDraft("")}>清除</button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-soft-action flex-1"
                                onClick={() => {
                                    const trimmed = cssDraft.trim();
                                    if (trimmed) kvSet(OFFLINE_APP_CSS_KEY, trimmed);
                                    else kvRemove(OFFLINE_APP_CSS_KEY);
                                    setOfflineAppCss(trimmed);
                                    setShowCssEditor(false);
                                }}
                            >
                                应用
                            </button>
                        </div>
                    </div>
                </PageShell>
            </div>
        );
    }

    const keyword = searchText.trim().toLowerCase();

    const filteredOfflineSessions = sessions
        .filter(s => {
            if (filterByIdentity && identity?.id && !doesSessionMatchIdentity(s, identity.id)) return false;
            if (tab === "groups" && !s.isGroup) return false;
            const title = s.isGroup
                ? (s.groupName || "群聊")
                : (s.alias || charMap.get(s.contactId)?.name || "");
            if (keyword && !title.toLowerCase().includes(keyword)) return false;
            return s.isGroup || charMap.has(s.contactId);
        })
        .sort((a, b) => {
            const turnA = getLastChatOfflineTurn(a.id)?.createdAt || "";
            const turnB = getLastChatOfflineTurn(b.id)?.createdAt || "";
            if (turnA !== turnB) return turnB.localeCompare(turnA);
            return (b.updatedAt || "").localeCompare(a.updatedAt || "");
        });

    const filteredCharacters = characters.filter(c => {
        if (filterByIdentity && identity?.id && resolveUserIdentity(c.id, "chat")?.id !== identity.id) return false;
        if (keyword && !(c.name || "").toLowerCase().includes(keyword)) return false;
        return true;
    });

    return (
        <div className="offline-chat-app chat-app absolute inset-0 flex flex-col overflow-hidden z-10 bg-[var(--c-page-body-bg)]">
            {offlineAppCss && <SessionCustomCSS css={offlineAppCss} scope=".offline-chat-app" />}

            <PageShell
                leftAction={
                    <div className="flex items-center min-w-max">
                        <button className="page-back-btn shrink-0 mr-2" type="button" onClick={onClose} aria-label="返回桌面">
                            <ChevronLeft size={24} strokeWidth={1.5} />
                        </button>
                        <div
                            className="flex items-center gap-2.5 cursor-pointer"
                            onClick={() => { setAllIdentities(loadUserIdentities()); setShowIdentityModal(true); }}
                            title="点击切换 User 面具"
                        >
                            <div className="w-[34px] h-[34px] rounded-full overflow-hidden bg-[var(--c-input)] flex items-center justify-center shrink-0">
                                {identity?.avatarUrl ? (
                                    <img src={identity.avatarUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <ChatFallbackAvatar />
                                )}
                            </div>
                            <div className="flex flex-col whitespace-nowrap">
                                <span className="ts-15 font-bold text-[var(--c-text-title)] leading-tight">
                                    {identity?.name || "用户"}
                                </span>
                                <span className="ts-10 text-[var(--c-icon)]">
                                    线下在场 · 点此换面具
                                </span>
                            </div>
                        </div>
                    </div>
                }
                rightAction={
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className="page-back-btn"
                            title="线下全局美化 CSS"
                            onClick={() => { setCssDraft(offlineAppCss); setShowCssEditor(true); }}
                        >
                            <Palette size={19} strokeWidth={1.6} />
                        </button>
                        <button
                            type="button"
                            className="page-back-btn"
                            title="选择角色开始线下"
                            onClick={() => setShowCharPicker(true)}
                        >
                            <Plus size={21} strokeWidth={1.7} />
                        </button>
                    </div>
                }
            >
                <div className="px-5 pt-4 pb-2">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <MapPin size={20} className="text-[var(--c-text-title)]" />
                            <span className="ts-24 font-bold text-[var(--c-text-title)]">线下剧场</span>
                        </div>
                        <span className="ts-11 text-[var(--c-icon)]">独立世界书 · 思维链 · 文风</span>
                    </div>
                    <div className="chat-search-bar">
                        <input
                            className="chat-search-input ts-14 w-full bg-transparent outline-none text-[var(--c-text-title)] placeholder:text-[var(--c-icon)]"
                            placeholder="搜索线下角色或群聊..."
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                        />
                    </div>
                </div>

                <div className="chat-list-tabs" style={{ paddingLeft: 20, paddingRight: 20 }}>
                    {([
                        { id: "recent", label: "最近线下" },
                        { id: "characters", label: "全部角色" },
                        { id: "groups", label: "群聊线下" },
                    ] as const).map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className={`chat-list-tab${tab === item.id ? " active" : ""}`}
                            onClick={() => setTab(item.id)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                <div className="px-5 pt-2 pb-8 flex flex-col gap-1">
                    {tab === "characters" ? (
                        filteredCharacters.length === 0 ? (
                            <div className="py-12 text-center ts-14 text-[var(--c-icon)]">
                                暂无符合当前面具的角色
                            </div>
                        ) : (
                            filteredCharacters.map(char => {
                                const sess = sessions.find(s => !s.isGroup && s.contactId === char.id);
                                const turnCount = sess ? loadChatOfflineTurns(sess.id).length : 0;
                                const lastTurn = sess ? getLastChatOfflineTurn(sess.id) : null;
                                return (
                                    <div
                                        key={char.id}
                                        className="minimal-list-item cursor-pointer"
                                        onClick={() => {
                                            const targetSession = createOrGetSession(char.id);
                                            setSessions(loadChatSessions());
                                            setActiveSession(targetSession);
                                        }}
                                    >
                                        <div className="minimal-avatar-wrapper">
                                            {char.avatar ? (
                                                <img src={char.avatar} className="w-full h-full object-cover rounded-full" alt="" />
                                            ) : (
                                                <ChatFallbackAvatar className="rounded-full" />
                                            )}
                                        </div>
                                        <div className="flex-1 overflow-hidden h-[48px] flex flex-col justify-center gap-1">
                                            <div className="flex justify-between items-center">
                                                <span className="ts-16 font-medium text-[var(--c-text-title)] truncate">{char.name}</span>
                                                <span className="ts-11 text-[var(--c-icon)]">{turnCount > 0 ? `${turnCount} 幕` : "未开始"}</span>
                                            </div>
                                            <span className="ts-13 text-[var(--c-text)] opacity-80 truncate">
                                                {lastTurn ? getChatOfflineTurnPreview(lastTurn).replace(/^\[线下\]\s*/, "") : "点击进入面对面线下互动"}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })
                        )
                    ) : (
                        (() => {
                            const list = tab === "groups"
                                ? filteredOfflineSessions.filter(s => s.isGroup)
                                : filteredOfflineSessions.filter(s => Boolean(getLastChatOfflineTurn(s.id)));
                            if (list.length === 0) {
                                return (
                                    <div className="py-12 flex flex-col items-center gap-3 text-center">
                                        <span className="ts-14 text-[var(--c-icon)]">
                                            {tab === "groups" ? "还没有群聊会话" : "还没有进行过的线下记录"}
                                        </span>
                                        <button
                                            type="button"
                                            className="ui-btn ui-btn-primary rounded-full px-5"
                                            onClick={() => setTab("characters")}
                                        >
                                            选择角色开启线下
                                        </button>
                                    </div>
                                );
                            }
                            return list.map(sess => {
                                const char = charMap.get(sess.contactId);
                                const lastTurn = getLastChatOfflineTurn(sess.id);
                                const turnCount = loadChatOfflineTurns(sess.id).length;
                                const preview = getChatOfflineTurnPreview(lastTurn).replace(/^\[线下\]\s*/, "") || "点击开启面对面线下模式";
                                const title = sess.isGroup
                                    ? (sess.groupName || "群聊")
                                    : (sess.alias || char?.name || "角色");
                                return (
                                    <div
                                        key={sess.id}
                                        className="minimal-list-item cursor-pointer"
                                        onClick={() => setActiveSession(sess)}
                                    >
                                        <div className="minimal-avatar-wrapper">
                                            {sess.isGroup ? (
                                                <div className="w-full h-full rounded-full bg-[var(--c-input)] flex items-center justify-center">
                                                    <Users size={20} className="text-[var(--c-icon)]" />
                                                </div>
                                            ) : char?.avatar ? (
                                                <img src={char.avatar} className="w-full h-full object-cover rounded-full" alt="" />
                                            ) : (
                                                <ChatFallbackAvatar className="rounded-full" />
                                            )}
                                        </div>
                                        <div className="flex-1 overflow-hidden h-[48px] flex flex-col justify-center gap-1">
                                            <div className="flex justify-between items-center gap-2">
                                                <span className="ts-16 font-medium text-[var(--c-text-title)] truncate">{title}</span>
                                                <span className="ts-11 text-[var(--c-icon)] shrink-0">
                                                    {lastTurn ? formatChatUiTime(lastTurn.createdAt) : ""}{turnCount > 0 ? ` · ${turnCount}幕` : ""}
                                                </span>
                                            </div>
                                            <span className="ts-13 text-[var(--c-text)] opacity-80 truncate">{preview}</span>
                                        </div>
                                    </div>
                                );
                            });
                        })()
                    )}
                </div>
            </PageShell>

            {/* 角色快速选择弹窗（两列网格） */}
            {showCharPicker && (
                <div className="modal-overlay" onClick={() => setShowCharPicker(false)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">选择角色进入线下</span>
                        {filteredCharacters.length === 0 ? (
                            <span className="menu-desc">暂无可用角色</span>
                        ) : (
                            <div className="grid grid-cols-2 gap-2 w-full max-h-[50vh] overflow-y-auto">
                                {filteredCharacters.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-[var(--c-input)] text-left min-w-0"
                                        onClick={() => {
                                            const sess = createOrGetSession(c.id);
                                            setSessions(loadChatSessions());
                                            setShowCharPicker(false);
                                            setActiveSession(sess);
                                        }}
                                    >
                                        <div className="w-8 h-8 rounded-full overflow-hidden bg-[var(--c-card)] shrink-0 flex items-center justify-center">
                                            {c.avatar ? <img src={c.avatar} alt="" className="w-full h-full object-cover" /> : <ChatFallbackAvatar />}
                                        </div>
                                        <span className="ts-13 font-medium text-[var(--c-text-title)] truncate">{c.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <button type="button" className="ui-btn ui-btn-ghost w-full" onClick={() => setShowCharPicker(false)}>取消</button>
                    </div>
                </div>
            )}

            {/* 面具切换弹窗（紧凑备注+头像） */}
            {showIdentityModal && (
                <div className="modal-overlay" onClick={() => setShowIdentityModal(false)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">切换当前 User 面具</span>
                        <div className="flex flex-col gap-2 w-full max-h-[50vh] overflow-y-auto">
                            {allIdentities.map(item => {
                                const selected = identity?.id === item.id;
                                const hasRemark = Boolean(item.remark?.trim());
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => selectGlobalIdentity(item.id)}
                                        className="flex items-center justify-between gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all"
                                        style={{
                                            background: selected
                                                ? "color-mix(in srgb, var(--c-text) 10%, transparent)"
                                                : "var(--c-input)",
                                        }}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="w-10 h-10 rounded-full overflow-hidden bg-[var(--c-card)] border border-black/10 shrink-0 flex items-center justify-center">
                                                {item.avatarUrl ? <img src={item.avatarUrl} alt="" className="w-full h-full object-cover" /> : <User size={18} />}
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="ts-14 font-bold text-[var(--c-text-title)] truncate">
                                                    {getUserIdentityDisplayName(item)}
                                                </span>
                                                {hasRemark && (
                                                    <span className="ts-11 text-[var(--c-icon)] truncate">姓名：{item.name}</span>
                                                )}
                                            </div>
                                        </div>
                                        {selected && <span className="ts-12 font-bold text-[var(--c-text-title)] shrink-0">当前</span>}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-between w-full pt-2 border-t border-[var(--c-border)]">
                            <span className="ts-12 text-[var(--c-text)]">只显示绑定了该面具的角色与群聊</span>
                            <Toggle
                                checked={filterByIdentity}
                                onChange={enabled => {
                                    setFilterByIdentity(enabled);
                                    saveChatAppSettings({ ...loadChatAppSettings(), filterByCurrentIdentity: enabled });
                                    window.dispatchEvent(new CustomEvent(CHAT_APP_SETTINGS_UPDATED_EVENT));
                                }}
                            />
                        </div>
                        <button type="button" className="ui-btn ui-btn-ghost w-full" onClick={() => setShowIdentityModal(false)}>关闭</button>
                    </div>
                </div>
            )}

            {/* 挂载独立的线下会话室（带专属「场记台」悬浮胶囊：独立世界书 / 思维链预设 / 文风预设 / 记忆总结） */}
            {activeSession && (
                <div className="chat-room-layer absolute inset-0 z-30">
                    <ChatRoom
                        key={`offline-only-${activeSession.id}`}
                        session={activeSession}
                        forceOffline
                        onBack={() => {
                            setActiveSession(null);
                            setShowStudioDrawer(false);
                            refreshAll();
                        }}
                        onDeleted={() => {
                            setActiveSession(null);
                            setShowStudioDrawer(false);
                            refreshAll();
                        }}
                    />

                    {/* 线下场记悬浮胶囊按钮（位于顶栏下方右侧，不遮挡顶栏与输入框） */}
                    <button
                        type="button"
                        onClick={() => setShowStudioDrawer(true)}
                        className="absolute right-3.5 z-[45] flex items-center gap-1.5 rounded-full bg-black/80 text-white px-3 py-1.5 shadow-lg backdrop-blur-md active:scale-95 transition-all"
                        style={{ top: "calc(var(--page-header-safe-top, 48px) + 58px)" }}
                        title="线下独立世界书 · 思维链 · 文风 · 记忆总结"
                    >
                        <SlidersHorizontal size={13} />
                        <span className="text-[11px] font-semibold tracking-wide">场记台</span>
                        {activeStudioSummary.activeCount > 0 && (
                            <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-emerald-400 text-black text-[10px] font-bold flex items-center justify-center">
                                {activeStudioSummary.activeCount}
                            </span>
                        )}
                    </button>

                    {showStudioDrawer && (
                        <OfflineStudioDrawer
                            session={activeSession}
                            character={charMap.get(activeSession.contactId) || null}
                            onClose={() => setShowStudioDrawer(false)}
                            onToast={showToast}
                        />
                    )}
                </div>
            )}

            {toastText && (
                <div className="fixed bottom-24 inset-x-0 z-[10080] flex justify-center pointer-events-none">
                    <div className="px-4 py-2 rounded-full bg-black/85 text-white ts-12 shadow-lg">
                        {toastText}
                    </div>
                </div>
            )}
        </div>
    );
}
