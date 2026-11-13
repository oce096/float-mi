"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, MapPin, MessageSquare, Palette, Plus, Users, User } from "lucide-react";
import {
    hydrateChatStorage,
    loadChatSessions,
    loadChatContacts,
    createOrGetSession,
    CHAT_APP_SETTINGS_UPDATED_EVENT,
    loadChatAppSettings,
    type ChatSession,
} from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity, loadUserIdentities, loadBindingConfig, saveBindingConfig } from "@/lib/settings-storage";
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
import { Toggle } from "@/components/ui/form";

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
        window.addEventListener("settings-bindings-updated", onSync);
        window.addEventListener("settings-identities-updated", onSync);
        window.addEventListener("chat-messages-updated", onSync);
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, onSync);
        return () => {
            window.removeEventListener("settings-bindings-updated", onSync);
            window.removeEventListener("settings-identities-updated", onSync);
            window.removeEventListener("chat-messages-updated", onSync);
            window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, onSync);
        };
    }, []);

    const characters = useMemo(() => (dbReady ? loadCharacters() : []), [dbReady, sessions]);
    const contacts = useMemo(() => (dbReady ? loadChatContacts() : []), [dbReady, sessions]);

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
    const charMap = new Map<string, Character>(characters.map(c => [c.id, c]));

    const filteredOfflineSessions = sessions
        .filter(s => {
            if (filterByIdentity && identity?.id && !doesSessionMatchIdentity(s, identity.id)) return false;
            if (tab === "groups" && !s.isGroup) return false;
            if (tab === "recent" && !getLastChatOfflineTurn(s.id) && !s.isGroup) {
                // recent 优先展示有过线下记录的会话，若没有任何线下记录则回退展示全部单聊联系人会话
            }
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
                        <span className="ts-11 text-[var(--c-icon)]">与微信聊天互通存档</span>
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
                                                {lastTurn ? getChatOfflineTurnPreview(lastTurn).replace(/^\[线下\]\s*/, "") : "点击直接进入面对面线下互动"}
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

            {/* 角色快速选择弹窗 */}
            {showCharPicker && (
                <div className="modal-overlay" onClick={() => setShowCharPicker(false)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">选择角色进入线下</span>
                        {filteredCharacters.length === 0 ? (
                            <span className="menu-desc">暂无可用角色</span>
                        ) : (
                            <div className="flex flex-col gap-1.5 w-full max-h-[50vh] overflow-y-auto">
                                {filteredCharacters.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        className="flex items-center gap-3 w-full px-3 py-2 rounded-xl bg-[var(--c-input)] text-left"
                                        onClick={() => {
                                            const sess = createOrGetSession(c.id);
                                            setSessions(loadChatSessions());
                                            setShowCharPicker(false);
                                            setActiveSession(sess);
                                        }}
                                    >
                                        <div className="w-9 h-9 rounded-full overflow-hidden bg-[var(--c-card)] shrink-0 flex items-center justify-center">
                                            {c.avatar ? <img src={c.avatar} alt="" className="w-full h-full object-cover" /> : <ChatFallbackAvatar />}
                                        </div>
                                        <span className="ts-14 font-medium text-[var(--c-text-title)] truncate">{c.name}</span>
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

            {/* 挂载独立的线下会话室（与聊天内的线下完全互通存档） */}
            {activeSession && (
                <div className="chat-room-layer absolute inset-0 z-30">
                    <ChatRoom
                        key={`offline-only-${activeSession.id}`}
                        session={activeSession}
                        forceOffline
                        onBack={() => {
                            setActiveSession(null);
                            refreshAll();
                        }}
                        onDeleted={() => {
                            setActiveSession(null);
                            refreshAll();
                        }}
                    />
                </div>
            )}
        </div>
    );
}
