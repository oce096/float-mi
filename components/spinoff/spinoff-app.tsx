"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
    BookMarked,
    BookOpen,
    Brain,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    Edit3,
    Feather,
    FolderOpen,
    FolderPlus,
    Library,
    Loader2,
    Palette,
    Play,
    Plus,
    RotateCcw,
    Save,
    Send,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    User,
    X,
} from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { loadCharacterWorldGroups } from "@/lib/character-world-storage";
import {
    resolveUserIdentity,
    loadUserIdentities,
    loadBindingConfig,
    saveBindingConfig,
    loadWorldBooks,
    loadPresets,
    loadRegexes,
    resolveBinding,
} from "@/lib/settings-storage";
import { CHAT_APP_SETTINGS_UPDATED_EVENT, loadChatAppSettings, saveChatAppSettings } from "@/lib/chat-storage";
import { getUserIdentityDisplayName, type UserIdentity } from "@/components/settings/user-identity";
import { BilingualTextBlock } from "@/components/chat/message-bubble";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { PageShell } from "@/components/ui/page-shell";
import { Toggle, Input } from "@/components/ui/form";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import {
    loadSpinoffFolders,
    createSpinoffFolder,
    deleteSpinoffFolder,
    loadSpinoffDirectives,
    upsertSpinoffDirective,
    deleteSpinoffDirective,
    loadSpinoffBooks,
    createSpinoffBook,
    updateSpinoffBook,
    deleteSpinoffBook,
    loadSpinoffTurns,
    saveSpinoffTurns,
    loadSpinoffCharStudio,
    saveSpinoffCharStudio,
    generateSpinoffTurnCompletion,
    SPINOFF_UPDATED_EVENT,
    type SpinoffFolder,
    type SpinoffDirective,
    type SpinoffDirectiveChapter,
    type SpinoffBook,
    type SpinoffBookTone,
    type SpinoffTurn,
    type SpinoffCharacterStudioConfig,
} from "@/lib/spinoff-storage";
import {
    loadOfflineCotPresets,
    upsertOfflineCotPreset,
    deleteOfflineCotPreset,
    loadOfflineStylePresets,
    upsertOfflineStylePreset,
    deleteOfflineStylePreset,
    DEFAULT_COT_PRESETS,
    DEFAULT_STYLE_PRESETS,
} from "@/lib/offline-studio-storage";

const SPINOFF_CSS_KEY = "spinoff-app-custom-css";

const BOOK_TONE_PALETTE: Record<SpinoffBookTone, { label: string; bg: string; spine: string; foil: string; border: string }> = {
    burgundy: {
        label: "勃艮第红",
        bg: "linear-gradient(155deg, #5e1d28 0%, #3b1018 100%)",
        spine: "#2b0910",
        foil: "#f3d5a5",
        border: "rgba(243, 213, 165, 0.35)",
    },
    navy: {
        label: "午夜藏蓝",
        bg: "linear-gradient(155deg, #1d324f 0%, #0f1c30 100%)",
        spine: "#0a1322",
        foil: "#dce7f7",
        border: "rgba(220, 231, 247, 0.32)",
    },
    forest: {
        label: "冷杉墨绿",
        bg: "linear-gradient(155deg, #1e3d33 0%, #11261f 100%)",
        spine: "#0b1a15",
        foil: "#dfead8",
        border: "rgba(223, 234, 216, 0.32)",
    },
    amber: {
        label: "古铜羊皮",
        bg: "linear-gradient(155deg, #6b4c2b 0%, #442e18 100%)",
        spine: "#2f1e0e",
        foil: "#fae6c7",
        border: "rgba(250, 230, 199, 0.35)",
    },
    plum: {
        label: "暮色紫檀",
        bg: "linear-gradient(155deg, #47284f 0%, #291530 100%)",
        spine: "#1c0d21",
        foil: "#eed9f5",
        border: "rgba(238, 217, 245, 0.32)",
    },
    noir: {
        label: "曜石黑金",
        bg: "linear-gradient(155deg, #2b2b2e 0%, #151517 100%)",
        spine: "#0a0a0c",
        foil: "#e6c88c",
        border: "rgba(230, 200, 140, 0.36)",
    },
};

const SPINOFF_CSS_EXAMPLE = `/* 番外馆美化示例：温暖羊皮纸书页质感 */
.spinoff-app .spinoff-reader-paper {
  background: #fbf7ef;
  color: #2c241b;
}
.spinoff-app .spinoff-book-card {
  box-shadow: 0 12px 26px rgba(35, 22, 10, 0.22);
}`;

function formatShortDate(iso?: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function SpinoffApp({ onClose }: { onClose: () => void }) {
    const [mainTab, setMainTab] = useState<"archives" | "directives">("archives");
    const [revision, setRevision] = useState(0);

    // 视图栈：主页 → 角色剧场藏书阁 → 书籍卷宗阅读器
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    const [activeBookId, setActiveBookId] = useState<string | null>(null);

    // 指令卷宗展开与编辑弹窗
    const [selectedFolderId, setSelectedFolderId] = useState<string>("all");
    const [openDirectiveId, setOpenDirectiveId] = useState<string | null>(null);
    const [editingDirective, setEditingDirective] = useState<{
        id?: string;
        folderId: string;
        title: string;
        premise: string;
        prompt: string;
        chapters: SpinoffDirectiveChapter[];
    } | null>(null);
    const [showNewFolderModal, setShowNewFolderModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [newFolderBadge, setNewFolderBadge] = useState("");

    // 新建/开演番外书籍弹窗
    const [newBookModal, setNewBookModal] = useState<{
        characterId: string;
        directiveId?: string;
        title: string;
        subtitle: string;
        openingPrompt: string;
        spineTone: SpinoffBookTone;
    } | null>(null);

    // 编辑书籍信息弹窗（改书名、归属指令夹、封面色）
    const [editingBookMeta, setEditingBookMeta] = useState<SpinoffBook | null>(null);

    // 面具与全局 CSS
    const [showIdentityModal, setShowIdentityModal] = useState(false);
    const [filterByIdentity, setFilterByIdentity] = useState(() => (typeof window !== "undefined" ? loadChatAppSettings().filterByCurrentIdentity !== false : true));
    const [showCssEditor, setShowCssEditor] = useState(false);
    const [customCss, setCustomCss] = useState(() => (typeof window !== "undefined" ? kvGet(SPINOFF_CSS_KEY) || "" : ""));
    const [cssDraft, setCssDraft] = useState("");
    const [toastText, setToastText] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToastText(msg);
        window.setTimeout(() => setToastText(prev => (prev === msg ? null : prev)), 2400);
    };

    useEffect(() => {
        const bump = () => {
            setRevision(v => v + 1);
            setFilterByIdentity(loadChatAppSettings().filterByCurrentIdentity !== false);
            setCustomCss(kvGet(SPINOFF_CSS_KEY) || "");
        };
        window.addEventListener(SPINOFF_UPDATED_EVENT, bump);
        window.addEventListener("settings-bindings-updated", bump);
        window.addEventListener("settings-identities-updated", bump);
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, bump);
        return () => {
            window.removeEventListener(SPINOFF_UPDATED_EVENT, bump);
            window.removeEventListener("settings-bindings-updated", bump);
            window.removeEventListener("settings-identities-updated", bump);
            window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, bump);
        };
    }, []);

    const characters = useMemo(() => { void revision; return loadCharacters(); }, [revision]);
    const worldGroups = useMemo(() => { void revision; return loadCharacterWorldGroups(); }, [revision]);
    const identity = useMemo(() => { void revision; return resolveUserIdentity(); }, [revision]);
    const allIdentities = useMemo(() => { void revision; return loadUserIdentities(); }, [revision]);
    const folders = useMemo(() => { void revision; return loadSpinoffFolders(); }, [revision]);
    const directives = useMemo(() => { void revision; return loadSpinoffDirectives(); }, [revision]);
    const books = useMemo(() => { void revision; return loadSpinoffBooks(); }, [revision]);

    const charMap = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);
    const charWorldMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const wg of worldGroups) {
            for (const cid of wg.memberIds) map.set(cid, wg.name);
        }
        return map;
    }, [worldGroups]);

    const visibleCharacters = useMemo(() => {
        if (!filterByIdentity || !identity?.id) return characters;
        return characters.filter(c => resolveUserIdentity(c.id, "chat")?.id === identity.id);
    }, [characters, filterByIdentity, identity?.id]);

    const activeBook = useMemo(() => books.find(b => b.id === activeBookId) || null, [books, activeBookId]);
    const selectedChar = useMemo(() => (selectedCharId ? charMap.get(selectedCharId) || null : null), [charMap, selectedCharId]);

    // ── CSS 编辑器子页 ──
    if (showCssEditor) {
        return (
            <div className="spinoff-app absolute inset-0 flex flex-col overflow-hidden z-20 bg-[#f7f4ee]">
                <PageShell title="番外馆 CSS 美化" onBack={() => setShowCssEditor(false)}>
                    <div className="p-4 flex flex-col gap-3 flex-1">
                        <div className="ts-12 text-[#5c5346]">
                            自定义番外馆的档案夹、精装书脊与书页阅读样式，支持保存与切换美化预设。
                        </div>
                        <textarea
                            value={cssDraft}
                            onChange={e => setCssDraft(e.target.value)}
                            placeholder="/* 输入番外馆自定义 CSS... */"
                            className="ui-textarea font-mono ts-13 leading-relaxed flex-1"
                            style={{ minHeight: 280, resize: "none" }}
                            spellCheck={false}
                        />
                        <div className="flex gap-2 items-center">
                            <CSSSchemeBar target="spinoff_app" currentCSS={cssDraft} onLoad={setCssDraft} />
                            <button type="button" className="ui-btn ui-btn-outline flex-1" onClick={() => setCssDraft(SPINOFF_CSS_EXAMPLE)}>示例</button>
                            <button type="button" className="ui-btn ui-btn-outline flex-1" onClick={() => setCssDraft("")}>清除</button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary flex-1"
                                onClick={() => {
                                    const trimmed = cssDraft.trim();
                                    if (trimmed) kvSet(SPINOFF_CSS_KEY, trimmed);
                                    else kvRemove(SPINOFF_CSS_KEY);
                                    setCustomCss(trimmed);
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

    // ── 第三层：翻开书籍阅读与演绎番外卷宗 ──
    if (activeBook) {
        const bookChar = charMap.get(activeBook.characterId) || null;
        const linkedDirective = directives.find(d => d.id === activeBook.directiveId) || null;
        return (
            <div className="spinoff-app absolute inset-0 flex flex-col overflow-hidden z-20 bg-[#f6f1e7]">
                {customCss && <SessionCustomCSS css={customCss} scope=".spinoff-app" />}
                <SpinoffBookReader
                    book={activeBook}
                    character={bookChar}
                    directive={linkedDirective}
                    allDirectives={directives}
                    onBack={() => {
                        setActiveBookId(null);
                        setRevision(v => v + 1);
                    }}
                    onEditMeta={() => setEditingBookMeta(activeBook)}
                    onDeleted={() => {
                        deleteSpinoffBook(activeBook.id);
                        setActiveBookId(null);
                        showToast("已销毁该番外卷宗");
                    }}
                    onToast={showToast}
                />
                {editingBookMeta && (
                    <BookMetaModal
                        book={editingBookMeta}
                        directives={directives}
                        onClose={() => setEditingBookMeta(null)}
                        onSave={(patch) => {
                            updateSpinoffBook(editingBookMeta.id, patch);
                            setEditingBookMeta(null);
                            setRevision(v => v + 1);
                            showToast("已更新书名与藏书归档");
                        }}
                    />
                )}
                {toastText && <SpinoffToast text={toastText} />}
            </div>
        );
    }

    // ── 第二层：单个角色的「剧场藏书阁」 ──
    if (selectedChar) {
        const charBooks = books.filter(b => b.characterId === selectedChar.id);
        const worldLabel = charWorldMap.get(selectedChar.id) || "默认世界";
        return (
            <div className="spinoff-app absolute inset-0 flex flex-col overflow-hidden z-15 bg-[#f5f0e6]">
                {customCss && <SessionCustomCSS css={customCss} scope=".spinoff-app" />}
                <CharacterBookshelfView
                    character={selectedChar}
                    worldLabel={worldLabel}
                    books={charBooks}
                    directives={directives}
                    onBack={() => setSelectedCharId(null)}
                    onOpenBook={(bookId) => setActiveBookId(bookId)}
                    onEditBook={(book) => setEditingBookMeta(book)}
                    onStartNewBook={(presetDirective) => {
                        setNewBookModal({
                            characterId: selectedChar.id,
                            directiveId: presetDirective?.id,
                            title: presetDirective ? presetDirective.title : `${selectedChar.name} · 番外手札`,
                            subtitle: presetDirective?.premise || "",
                            openingPrompt: presetDirective?.prompt || "",
                            spineTone: "burgundy",
                        });
                    }}
                    onToast={showToast}
                />

                {newBookModal && (
                    <NewBookLaunchModal
                        state={newBookModal}
                        characters={visibleCharacters.length > 0 ? visibleCharacters : characters}
                        directives={directives}
                        onChange={setNewBookModal}
                        onClose={() => setNewBookModal(null)}
                        onConfirm={() => {
                            const created = createSpinoffBook({
                                characterId: newBookModal.characterId,
                                directiveId: newBookModal.directiveId || undefined,
                                title: newBookModal.title,
                                subtitle: newBookModal.subtitle,
                                openingPrompt: newBookModal.openingPrompt,
                                spineTone: newBookModal.spineTone,
                            });
                            setNewBookModal(null);
                            setSelectedCharId(created.characterId);
                            setActiveBookId(created.id);
                        }}
                    />
                )}

                {editingBookMeta && (
                    <BookMetaModal
                        book={editingBookMeta}
                        directives={directives}
                        onClose={() => setEditingBookMeta(null)}
                        onSave={(patch) => {
                            updateSpinoffBook(editingBookMeta.id, patch);
                            setEditingBookMeta(null);
                            setRevision(v => v + 1);
                            showToast("已更新书籍卷宗信息");
                        }}
                    />
                )}
                {toastText && <SpinoffToast text={toastText} />}
            </div>
        );
    }

    // ── 第一层：番外馆主大厅（角色档案室 / 番外指令卷宗库） ──
    const openDirective = directives.find(d => d.id === openDirectiveId) || null;
    const filteredDirectives = selectedFolderId === "all"
        ? directives
        : directives.filter(d => d.folderId === selectedFolderId);

    return (
        <div className="spinoff-app absolute inset-0 flex flex-col overflow-hidden z-10 bg-[#f5f0e6] text-[#2a231c]">
            {customCss && <SessionCustomCSS css={customCss} scope=".spinoff-app" />}

            {/* 顶部典藏馆标题栏 */}
            <header
                className="shrink-0 px-4 pb-3 flex items-center justify-between border-b border-[#dccfb8]"
                style={{
                    paddingTop: "calc(var(--page-header-safe-top, 48px) + 6px)",
                    background: "linear-gradient(180deg, #efe7d6 0%, #f5f0e6 100%)",
                }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-[#2a231c]/5 flex items-center justify-center text-[#2a231c] shrink-0"
                        aria-label="返回桌面"
                    >
                        <ChevronLeft size={22} strokeWidth={1.7} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowIdentityModal(true)}
                        className="flex items-center gap-2 min-w-0 text-left"
                    >
                        <div className="w-8 h-8 rounded-full overflow-hidden border border-[#cbbba0] bg-[#e8decb] shrink-0 flex items-center justify-center">
                            {identity?.avatarUrl ? (
                                <img src={identity.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <User size={15} className="text-[#6e5d47]" />
                            )}
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[14px] font-bold text-[#241d16] truncate leading-tight">
                                {identity?.name || "馆主"}
                            </span>
                            <span className="font-mono text-[9.5px] tracking-wider text-[#847259] uppercase">
                                APOCRYPHA // 只读记忆·不入主线
                            </span>
                        </div>
                    </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => { setCssDraft(customCss); setShowCssEditor(true); }}
                        className="w-9 h-9 rounded-full bg-[#2a231c]/5 flex items-center justify-center text-[#4a3e31]"
                        title="番外馆 CSS 美化"
                    >
                        <Palette size={17} />
                    </button>
                    {mainTab === "directives" && (
                        <button
                            type="button"
                            onClick={() => {
                                setEditingDirective({
                                    folderId: selectedFolderId === "all" ? folders[0]?.id || "folder_if" : selectedFolderId,
                                    title: "",
                                    premise: "",
                                    prompt: "",
                                    chapters: [],
                                });
                            }}
                            className="h-9 px-3 rounded-full bg-[#2a231c] text-[#f7eedc] text-[12px] font-semibold flex items-center gap-1 shadow-sm active:scale-95 transition-all"
                        >
                            <Plus size={14} />
                            <span>收编指令</span>
                        </button>
                    )}
                </div>
            </header>

            {/* 顶部切换双翼：角色档案藏书阁 / 番外指令卷宗夹 */}
            <div className="px-4 pt-3 pb-2 shrink-0">
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#e6dcc8] border border-[#d6c7ad]">
                    <button
                        type="button"
                        onClick={() => setMainTab("archives")}
                        className={`py-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                            mainTab === "archives"
                                ? "bg-[#2a231c] text-[#f7eedc] shadow-sm"
                                : "text-[#635442]"
                        }`}
                    >
                        <Library size={15} />
                        <span>角色档案与藏书</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setMainTab("directives")}
                        className={`py-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                            mainTab === "directives"
                                ? "bg-[#2a231c] text-[#f7eedc] shadow-sm"
                                : "text-[#635442]"
                        }`}
                    >
                        <FolderOpen size={15} />
                        <span>番外指令卷宗 ({directives.length})</span>
                    </button>
                </div>
            </div>

            {/* 主列表滚动区 */}
            <div className="flex-1 overflow-y-auto px-4 pb-8">
                {mainTab === "archives" ? (
                    visibleCharacters.length === 0 ? (
                        <div className="py-16 text-center flex flex-col items-center gap-2 text-[#85745e]">
                            <Library size={32} strokeWidth={1.4} />
                            <span className="text-[14px] font-semibold">当前面具下还没有关联的角色档案</span>
                            <span className="text-[12px] opacity-80">点击左上角头像可切换面具或解除面具过滤</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                            {visibleCharacters.map((char, idx) => {
                                const charBooks = books.filter(b => b.characterId === char.id);
                                const latestBook = charBooks[0];
                                const worldName = charWorldMap.get(char.id) || "默认世界";
                                return (
                                    <button
                                        key={char.id}
                                        type="button"
                                        onClick={() => setSelectedCharId(char.id)}
                                        className="spinoff-dossier-card group relative flex flex-col justify-between rounded-2xl border border-[#d6c6ac] bg-[#fcf9f2] p-3.5 text-left shadow-[0_6px_18px_rgba(60,42,20,0.06)] active:scale-[0.98] transition-all overflow-hidden"
                                        style={{ minHeight: 164 }}
                                    >
                                        {/* 右上角牛皮纸折角编号 */}
                                        <div className="flex items-center justify-between w-full border-b border-dashed border-[#dfd2bc] pb-1.5">
                                            <span className="font-mono text-[9.5px] tracking-widest text-[#8c7a61] uppercase">
                                                FILE // {String(idx + 1).padStart(2, "0")}
                                            </span>
                                            <span className="px-1.5 py-0.5 rounded bg-[#efe6d5] text-[#6e5c44] text-[10px] font-semibold truncate max-w-[78px]">
                                                {worldName}
                                            </span>
                                        </div>

                                        {/* 角色肖像与姓名 */}
                                        <div className="flex items-center gap-2.5 my-2.5">
                                            <div className="w-12 h-12 rounded-xl overflow-hidden border-2 border-[#e5d8c1] bg-[#ede4d3] shrink-0 shadow-inner flex items-center justify-center">
                                                {char.avatar ? (
                                                    <img src={char.avatar} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-[16px] font-bold text-[#6e5c44]">{char.name.slice(0, 1)}</span>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1 flex flex-col">
                                                <span className="text-[15px] font-bold text-[#241d16] truncate">{char.name}</span>
                                                <span className="text-[11px] text-[#847259] mt-0.5">
                                                    藏书 <strong className="text-[#3d3022]">{charBooks.length}</strong> 册
                                                </span>
                                            </div>
                                        </div>

                                        {/* 底部最近番外书名预览 */}
                                        <div className="w-full pt-2 border-t border-[#ede3d2] flex items-center justify-between gap-1">
                                            <span className="text-[11px] text-[#786750] truncate">
                                                {latestBook ? `📖 《${latestBook.title}》` : "点击进入剧场藏书阁"}
                                            </span>
                                            <ChevronRight size={13} className="text-[#99866d] shrink-0" />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )
                ) : (
                    /* 番外指令卷宗夹视图 */
                    <div className="flex flex-col gap-3 pt-1">
                        {/* 文件夹分类横条 */}
                        <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-1">
                            <button
                                type="button"
                                onClick={() => setSelectedFolderId("all")}
                                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold shrink-0 transition-all ${
                                    selectedFolderId === "all"
                                        ? "bg-[#2a231c] text-[#f7eedc]"
                                        : "bg-[#eae0ce] text-[#5e4f3e]"
                                }`}
                            >
                                全部卷夹 ({directives.length})
                            </button>
                            {folders.map(folder => {
                                const count = directives.filter(d => d.folderId === folder.id).length;
                                const active = selectedFolderId === folder.id;
                                return (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => setSelectedFolderId(folder.id)}
                                        className={`px-3 py-1.5 rounded-full text-[12px] font-semibold shrink-0 flex items-center gap-1 transition-all ${
                                            active ? "bg-[#2a231c] text-[#f7eedc]" : "bg-[#eae0ce] text-[#5e4f3e]"
                                        }`}
                                    >
                                        <span>📁 {folder.name}</span>
                                        <span className="opacity-70 text-[10px]">{count}</span>
                                    </button>
                                );
                            })}
                            <button
                                type="button"
                                onClick={() => { setNewFolderName(""); setNewFolderBadge(""); setShowNewFolderModal(true); }}
                                className="px-2.5 py-1.5 rounded-full bg-[#fcf9f2] border border-dashed border-[#c7b69c] text-[#6e5c44] text-[11px] font-semibold shrink-0 flex items-center gap-1"
                            >
                                <FolderPlus size={13} />
                                <span>新分类</span>
                            </button>
                        </div>

                        {selectedFolderId !== "all" && folders.length > 1 && (
                            <div className="flex items-center justify-between px-1 text-[11px] text-[#847259]">
                                <span>当前卷夹：{folders.find(f => f.id === selectedFolderId)?.name}</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        deleteSpinoffFolder(selectedFolderId);
                                        setSelectedFolderId("all");
                                        showToast("已移除分类，原指令已归入首个卷夹");
                                    }}
                                    className="text-[#b33a3a] font-medium"
                                >
                                    删除此分类夹
                                </button>
                            </div>
                        )}

                        {/* 指令卷宗卡片列表 */}
                        {filteredDirectives.length === 0 ? (
                            <div className="py-14 text-center text-[13px] text-[#847259]">
                                该分类下还没有收藏番外指令，点右上角「收编指令」添加吧
                            </div>
                        ) : (
                            filteredDirectives.map(dir => {
                                const folder = folders.find(f => f.id === dir.folderId);
                                const collectedBooks = books.filter(b => b.directiveId === dir.id);
                                const isExpanded = openDirective?.id === dir.id;
                                return (
                                    <div
                                        key={dir.id}
                                        className="rounded-2xl border border-[#d6c6ac] bg-[#fcf9f2] shadow-[0_5px_16px_rgba(60,42,20,0.05)] overflow-hidden transition-all"
                                    >
                                        {/* 卷宗封面头：点击展开卷宗详情 */}
                                        <button
                                            type="button"
                                            onClick={() => setOpenDirectiveId(isExpanded ? null : dir.id)}
                                            className="w-full p-4 text-left flex flex-col gap-2"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="px-2 py-0.5 rounded bg-[#2a231c] text-[#f3d9a4] font-mono text-[10px] font-bold tracking-wider shrink-0">
                                                        {folder?.badge || "DOSSIER"}
                                                    </span>
                                                    <span className="text-[11px] text-[#7c6a53] truncate">
                                                        {folder?.name || "未分类"}
                                                    </span>
                                                    {(dir.chapters?.length || 0) > 0 && (
                                                        <span className="px-1.5 py-0.5 rounded bg-[#e8decb] text-[#5c4b37] text-[10px] font-semibold shrink-0">
                                                            含 {dir.chapters!.length} 幕后续
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {collectedBooks.length > 0 && (
                                                        <span className="px-2 py-0.5 rounded-full bg-[#5e1d28]/10 text-[#5e1d28] text-[10px] font-bold">
                                                            已藏 {collectedBooks.length} 卷
                                                        </span>
                                                    )}
                                                    <ChevronDown
                                                        size={16}
                                                        className={`text-[#7c6a53] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                                    />
                                                </div>
                                            </div>

                                            <div className="text-[16px] font-bold text-[#221b14] leading-snug">
                                                {dir.title}
                                            </div>
                                            <div className="text-[12.5px] text-[#695a47] line-clamp-2 leading-relaxed">
                                                {dir.premise || dir.prompt}
                                            </div>
                                        </button>

                                        {/* 展开后的密封卷宗内页：主指令 + 后续章节 + 收藏在此指令下的已玩番外书籍 */}
                                        {isExpanded && (
                                            <div className="px-4 pb-4 pt-2 border-t border-dashed border-[#dcd0bc] bg-[#f8f3e8] flex flex-col gap-3">
                                                <div className="rounded-xl bg-[#fcf9f2] border border-[#e3d7c3] p-3 flex flex-col gap-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-mono text-[10px] font-bold tracking-wider text-[#847259]">▪ 主幕指令 PROMPT</span>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditingDirective({
                                                                    id: dir.id,
                                                                    folderId: dir.folderId,
                                                                    title: dir.title,
                                                                    premise: dir.premise,
                                                                    prompt: dir.prompt,
                                                                    chapters: dir.chapters ? [...dir.chapters] : [],
                                                                })}
                                                                className="text-[11px] font-semibold text-[#5c4b37] flex items-center gap-0.5"
                                                            >
                                                                <Edit3 size={12} /> 编辑/加后续
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    deleteSpinoffDirective(dir.id);
                                                                    setOpenDirectiveId(null);
                                                                    showToast("已删除该番外指令");
                                                                }}
                                                                className="text-[11px] font-semibold text-[#b33a3a] flex items-center gap-0.5"
                                                            >
                                                                <Trash2 size={12} /> 删除
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <p className="text-[12px] text-[#3a3025] whitespace-pre-wrap leading-relaxed m-0">
                                                        {dir.prompt}
                                                    </p>
                                                </div>

                                                {/* 同一档案内的后续幕次列表 */}
                                                {dir.chapters && dir.chapters.length > 0 && (
                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="font-mono text-[10px] font-bold tracking-wider text-[#847259] px-1">
                                                            ▪ 系列后续章节 ({dir.chapters.length})
                                                        </span>
                                                        {dir.chapters.map((ch, idx) => (
                                                            <div key={ch.id} className="rounded-xl bg-[#fcf9f2] border border-[#e3d7c3] p-2.5 flex flex-col gap-1">
                                                                <span className="text-[12px] font-bold text-[#2a231c]">
                                                                    续幕 {idx + 1} · {ch.title}
                                                                </span>
                                                                <span className="text-[11.5px] text-[#665744] whitespace-pre-wrap leading-relaxed">
                                                                    {ch.prompt}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* 已收藏在此番外指令下的角色剧情卷宗 */}
                                                <div className="flex flex-col gap-1.5">
                                                    <span className="font-mono text-[10px] font-bold tracking-wider text-[#847259] px-1">
                                                        ▪ 收录于此指令下的番外藏书 ({collectedBooks.length})
                                                    </span>
                                                    {collectedBooks.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-[#d6c7ae] px-3 py-2.5 text-[11.5px] text-[#8c7b64]">
                                                            暂无已收录的演绎卷宗。可点击下方按钮选角色直接开演，或在任意番外书内归档到此指令下。
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col gap-1.5">
                                                            {collectedBooks.map(b => {
                                                                const c = charMap.get(b.characterId);
                                                                return (
                                                                    <button
                                                                        key={b.id}
                                                                        type="button"
                                                                        onClick={() => setActiveBookId(b.id)}
                                                                        className="flex items-center justify-between gap-2 rounded-xl bg-[#fcf9f2] border border-[#ded0b8] px-3 py-2 text-left hover:bg-[#f2ead9]"
                                                                    >
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <BookMarked size={14} className="text-[#5e1d28] shrink-0" />
                                                                            <span className="text-[12.5px] font-bold text-[#241d16] truncate">
                                                                                《{b.title}》
                                                                            </span>
                                                                            <span className="text-[11px] text-[#7c6a53] shrink-0">
                                                                                · {c?.name || "角色"} ({b.turnCount}幕)
                                                                            </span>
                                                                        </div>
                                                                        <ChevronRight size={14} className="text-[#8c7b64] shrink-0" />
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const firstChar = visibleCharacters[0] || characters[0];
                                                        if (!firstChar) {
                                                            showToast("请先创建角色");
                                                            return;
                                                        }
                                                        setNewBookModal({
                                                            characterId: firstChar.id,
                                                            directiveId: dir.id,
                                                            title: dir.title,
                                                            subtitle: dir.premise,
                                                            openingPrompt: dir.prompt,
                                                            spineTone: "burgundy",
                                                        });
                                                    }}
                                                    className="w-full py-2.5 rounded-xl bg-[#2a231c] text-[#f7eedc] text-[13px] font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.99]"
                                                >
                                                    <Play size={14} fill="currentColor" />
                                                    <span>用此指令选角色开启新番外卷宗</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* 新建分类夹弹窗 */}
            {showNewFolderModal && (
                <div className="modal-overlay" onClick={() => setShowNewFolderModal(false)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">新建指令分类卷夹</span>
                        <Input
                            type="text"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            placeholder="分类名称，如：古风IF / 悬疑副本 / 节日番外"
                        />
                        <Input
                            type="text"
                            value={newFolderBadge}
                            onChange={e => setNewFolderBadge(e.target.value)}
                            placeholder="角标代号（选填，如 AU / SP）"
                        />
                        <div className="flex gap-2 w-full">
                            <button type="button" className="ui-btn ui-btn-ghost flex-1" onClick={() => setShowNewFolderModal(false)}>取消</button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary flex-1"
                                disabled={!newFolderName.trim()}
                                onClick={() => {
                                    const created = createSpinoffFolder(newFolderName, newFolderBadge);
                                    setSelectedFolderId(created.id);
                                    setShowNewFolderModal(false);
                                    showToast(`已创建卷夹「${created.name}」`);
                                }}
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 收编/编辑番外指令弹窗（支持添加多幕后续指令） */}
            {editingDirective && (
                <DirectiveEditorModal
                    draft={editingDirective}
                    folders={folders}
                    onChange={setEditingDirective}
                    onClose={() => setEditingDirective(null)}
                    onSave={() => {
                        if (!editingDirective.title.trim() || !editingDirective.prompt.trim()) {
                            showToast("请填写指令标题与正文");
                            return;
                        }
                        const saved = upsertSpinoffDirective({
                            id: editingDirective.id,
                            folderId: editingDirective.folderId,
                            title: editingDirective.title,
                            premise: editingDirective.premise,
                            prompt: editingDirective.prompt,
                            chapters: editingDirective.chapters.filter(c => c.title.trim() || c.prompt.trim()),
                        });
                        setEditingDirective(null);
                        setOpenDirectiveId(saved.id);
                        showToast("番外指令卷宗已保存");
                    }}
                />
            )}

            {/* 开启新番外书籍弹窗 */}
            {newBookModal && (
                <NewBookLaunchModal
                    state={newBookModal}
                    characters={visibleCharacters.length > 0 ? visibleCharacters : characters}
                    directives={directives}
                    onChange={setNewBookModal}
                    onClose={() => setNewBookModal(null)}
                    onConfirm={() => {
                        const created = createSpinoffBook({
                            characterId: newBookModal.characterId,
                            directiveId: newBookModal.directiveId || undefined,
                            title: newBookModal.title,
                            subtitle: newBookModal.subtitle,
                            openingPrompt: newBookModal.openingPrompt,
                            spineTone: newBookModal.spineTone,
                        });
                        setNewBookModal(null);
                        setSelectedCharId(created.characterId);
                        setActiveBookId(created.id);
                    }}
                />
            )}

            {/* 面具切换弹窗 */}
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
                                        onClick={() => {
                                            const cfg = loadBindingConfig();
                                            saveBindingConfig({
                                                ...cfg,
                                                globalDefaults: { ...cfg.globalDefaults, userIdentityId: item.id },
                                            });
                                            setShowIdentityModal(false);
                                        }}
                                        className="flex items-center justify-between gap-3 w-full px-3 py-2.5 rounded-xl text-left"
                                        style={{
                                            background: selected ? "color-mix(in srgb, var(--c-text) 10%, transparent)" : "var(--c-input)",
                                        }}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="w-10 h-10 rounded-full overflow-hidden bg-[var(--c-card)] shrink-0 flex items-center justify-center">
                                                {item.avatarUrl ? <img src={item.avatarUrl} alt="" className="w-full h-full object-cover" /> : <User size={18} />}
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="ts-14 font-bold text-[var(--c-text-title)] truncate">{getUserIdentityDisplayName(item)}</span>
                                                {hasRemark && <span className="ts-11 text-[var(--c-icon)] truncate">姓名：{item.name}</span>}
                                            </div>
                                        </div>
                                        {selected && <Check size={16} className="shrink-0" />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-between w-full pt-2 border-t border-[var(--c-border)]">
                            <span className="ts-12 text-[var(--c-text)]">只显示绑定了该面具的角色</span>
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

            {toastText && <SpinoffToast text={toastText} />}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   角色专属「剧场藏书阁」：精装烫金书籍陈列架 + 场记设置抽屉
   ════════════════════════════════════════════════════════════════ */

function CharacterBookshelfView({
    character,
    worldLabel,
    books,
    directives,
    onBack,
    onOpenBook,
    onEditBook,
    onStartNewBook,
    onToast,
}: {
    character: Character;
    worldLabel: string;
    books: SpinoffBook[];
    directives: SpinoffDirective[];
    onBack: () => void;
    onOpenBook: (bookId: string) => void;
    onEditBook: (book: SpinoffBook) => void;
    onStartNewBook: (directive?: SpinoffDirective) => void;
    onToast: (msg: string) => void;
}) {
    const [shelfTab, setShelfTab] = useState<"bookshelf" | "quick_directives">("bookshelf");
    const [showStudio, setShowStudio] = useState(false);

    return (
        <div className="flex flex-col h-full bg-[#f5f0e6] text-[#2a231c]">
            {/* 角色档案顶栏 */}
            <header
                className="shrink-0 px-4 pb-3.5 border-b border-[#dccfb8]"
                style={{
                    paddingTop: "calc(var(--page-header-safe-top, 48px) + 6px)",
                    background: "linear-gradient(180deg, #eae0cd 0%, #f5f0e6 100%)",
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="w-9 h-9 rounded-full bg-[#2a231c]/5 flex items-center justify-center text-[#2a231c] shrink-0"
                    >
                        <ChevronLeft size={22} />
                    </button>
                    <span className="font-mono text-[10px] tracking-[0.2em] text-[#7c6a53] uppercase">
                        CHARACTER THEATER ARCHIVE
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowStudio(true)}
                        className="h-8 px-3 rounded-full bg-[#2a231c] text-[#f7eedc] text-[11.5px] font-semibold flex items-center gap-1 shadow-sm"
                    >
                        <SlidersHorizontal size={12} />
                        <span>场记配置</span>
                    </button>
                </div>

                {/* 角色档案名片区 */}
                <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-[#fcf9f2] border border-[#dad0be] p-3 shadow-sm">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-14 h-14 rounded-xl overflow-hidden border-2 border-[#e2d4bc] bg-[#ebe2d1] shrink-0 flex items-center justify-center">
                            {character.avatar ? (
                                <img src={character.avatar} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-[18px] font-bold text-[#6e5c44]">{character.name.slice(0, 1)}</span>
                            )}
                        </div>
                        <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[17px] font-bold text-[#221b14] truncate">{character.name}</span>
                                <span className="px-1.5 py-0.5 rounded bg-[#efe6d5] text-[#6e5c44] text-[10px] font-semibold shrink-0">
                                    {worldLabel}
                                </span>
                            </div>
                            <span className="text-[11.5px] text-[#7c6a53] mt-0.5">
                                已收录 <strong className="text-[#2a231c]">{books.length}</strong> 册番外卷宗 · 读取全部记忆且不污染主线
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onStartNewBook()}
                        className="px-3.5 py-2 rounded-xl bg-[#5e1d28] text-[#f9ebd2] text-[12px] font-bold shrink-0 shadow-sm active:scale-95 transition-all"
                    >
                        ＋ 新开一卷
                    </button>
                </div>

                {/* 子栏切换：已玩番外藏书架 / 从指令库选梗开演 */}
                <div className="grid grid-cols-2 gap-1.5 mt-3 p-1 rounded-xl bg-[#e6dcc8]">
                    <button
                        type="button"
                        onClick={() => setShelfTab("bookshelf")}
                        className={`py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                            shelfTab === "bookshelf" ? "bg-[#fcf9f2] text-[#221b14] shadow-sm" : "text-[#6c5c48]"
                        }`}
                    >
                        📚 番外藏书架 ({books.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setShelfTab("quick_directives")}
                        className={`py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                            shelfTab === "quick_directives" ? "bg-[#fcf9f2] text-[#221b14] shadow-sm" : "text-[#6c5c48]"
                        }`}
                    >
                        🎬 挑指令开剧场 ({directives.length})
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-4 pb-10">
                {shelfTab === "bookshelf" ? (
                    books.length === 0 ? (
                        <div className="py-14 flex flex-col items-center text-center gap-3 text-[#7c6a53]">
                            <BookOpen size={36} strokeWidth={1.3} />
                            <div className="text-[14px] font-bold text-[#3b3024]">书架上还没有 {character.name} 的番外藏书</div>
                            <div className="text-[12px] max-w-[240px] leading-relaxed">
                                每一本精装书都对应一部独立玩过的番外卷宗，书名可随时修改，点击下方按钮开启第一册吧。
                            </div>
                            <button
                                type="button"
                                onClick={() => onStartNewBook()}
                                className="mt-1 px-5 py-2.5 rounded-full bg-[#2a231c] text-[#f7eedc] text-[13px] font-bold shadow-md"
                            >
                                开启首册番外卷宗
                            </button>
                        </div>
                    ) : (
                        /* 古典木质藏书格两列精装书籍陈列 */
                        <div className="grid grid-cols-2 gap-4">
                            {books.map((book, index) => {
                                const palette = BOOK_TONE_PALETTE[book.spineTone] || BOOK_TONE_PALETTE.burgundy;
                                const linkedDir = directives.find(d => d.id === book.directiveId);
                                return (
                                    <div key={book.id} className="flex flex-col gap-1.5">
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => onOpenBook(book.id)}
                                            onKeyDown={(e) => { if (e.key === "Enter") onOpenBook(book.id); }}
                                            className="spinoff-book-card relative rounded-r-2xl rounded-l-[5px] cursor-pointer select-none active:scale-[0.98] transition-transform overflow-hidden flex"
                                            style={{
                                                height: 206,
                                                background: palette.bg,
                                                boxShadow: "0 10px 22px rgba(32, 20, 10, 0.22), inset -2px 0 4px rgba(255,255,255,0.08)",
                                            }}
                                        >
                                            {/* 左侧精装书脊凹槽与压纹 */}
                                            <div
                                                className="w-[15px] h-full shrink-0 flex flex-col justify-between py-3 items-center"
                                                style={{
                                                    background: palette.spine,
                                                    borderRight: `1px solid ${palette.border}`,
                                                    boxShadow: "inset -2px 0 4px rgba(0,0,0,0.35)",
                                                }}
                                            >
                                                <span className="w-2 h-[1px]" style={{ background: palette.foil, opacity: 0.6 }} />
                                                <span className="w-2 h-[1px]" style={{ background: palette.foil, opacity: 0.6 }} />
                                            </div>

                                            {/* 封面烫金内框 */}
                                            <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                                                <div
                                                    className="flex-1 rounded-lg p-2.5 flex flex-col justify-between min-w-0"
                                                    style={{ border: `1px solid ${palette.border}` }}
                                                >
                                                    <div className="flex items-center justify-between gap-1">
                                                        <span
                                                            className="font-mono text-[9px] tracking-[0.16em] uppercase opacity-80"
                                                            style={{ color: palette.foil }}
                                                        >
                                                            VOL.{String(books.length - index).padStart(2, "0")}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onEditBook(book);
                                                            }}
                                                            className="p-1 rounded hover:bg-white/10 transition-colors"
                                                            style={{ color: palette.foil }}
                                                            title="修改书名与归档指令"
                                                        >
                                                            <Edit3 size={12} />
                                                        </button>
                                                    </div>

                                                    {/* 书名铭牌 */}
                                                    <div className="my-auto py-1">
                                                        <div
                                                            className="text-[14.5px] font-bold leading-snug line-clamp-3 break-words"
                                                            style={{
                                                                color: palette.foil,
                                                                fontFamily: 'Georgia, "Songti SC", "Noto Serif SC", serif',
                                                            }}
                                                        >
                                                            {book.title}
                                                        </div>
                                                        {linkedDir && (
                                                            <div
                                                                className="mt-1.5 text-[10px] truncate opacity-75"
                                                                style={{ color: palette.foil }}
                                                            >
                                                                ✦ {linkedDir.title}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* 书封底栏：幕数与日期 */}
                                                    <div
                                                        className="pt-1.5 border-t flex items-center justify-between text-[9.5px] opacity-80"
                                                        style={{ borderColor: palette.border, color: palette.foil }}
                                                    >
                                                        <span>{book.turnCount} 幕记录</span>
                                                        <span>{formatShortDate(book.updatedAt)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 书架托板下的一行摘要 */}
                                        <span className="px-1 text-[11px] text-[#7c6a53] truncate">
                                            {book.lastPreview || book.subtitle || "点击翻阅此卷番外"}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : (
                    /* 快速从番外指令库挑选一个剧场给该角色开书 */
                    <div className="flex flex-col gap-2.5">
                        {directives.map(dir => (
                            <div
                                key={dir.id}
                                className="rounded-2xl border border-[#d6c6ac] bg-[#fcf9f2] p-3.5 flex items-center justify-between gap-3"
                            >
                                <div className="min-w-0 flex-1 flex flex-col gap-1">
                                    <span className="text-[14px] font-bold text-[#221b14] truncate">{dir.title}</span>
                                    <span className="text-[11.5px] text-[#6d5d49] line-clamp-2">{dir.premise || dir.prompt}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onStartNewBook(dir)}
                                    className="px-3 py-2 rounded-xl bg-[#2a231c] text-[#f7eedc] text-[12px] font-bold shrink-0 flex items-center gap-1"
                                >
                                    <Play size={12} fill="currentColor" />
                                    <span>开卷</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showStudio && (
                <SpinoffStudioModal
                    character={character}
                    onClose={() => setShowStudio(false)}
                    onToast={onToast}
                />
            )}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   第三层：翻开书籍阅读与演绎页（羊皮纸书页 + 折叠思维链 + 续幕推进 + 归档指令）
   ════════════════════════════════════════════════════════════════ */

function SpinoffBookReader({
    book,
    character,
    directive,
    allDirectives,
    onBack,
    onEditMeta,
    onDeleted,
    onToast,
}: {
    book: SpinoffBook;
    character: Character | null;
    directive: SpinoffDirective | null;
    allDirectives: SpinoffDirective[];
    onBack: () => void;
    onEditMeta: () => void;
    onDeleted: () => void;
    onToast: (msg: string) => void;
}) {
    const [turns, setTurns] = useState<SpinoffTurn[]>(() => loadSpinoffTurns(book.id));
    const [inputText, setInputText] = useState("");
    const [selectedChapterPrompt, setSelectedChapterPrompt] = useState<string>("");
    const [selectedChapterLabel, setSelectedChapterLabel] = useState<string>("");
    const [generating, setGenerating] = useState(false);
    const [streamText, setStreamText] = useState("");
    const [expandedCotIds, setExpandedCotIds] = useState<Set<string>>(() => new Set());
    const [editingTurn, setEditingTurn] = useState<{ id: string; userContent: string; assistantContent: string } | null>(null);
    const [showStudio, setShowStudio] = useState(false);
    const [confirmDeleteBook, setConfirmDeleteBook] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setTurns(loadSpinoffTurns(book.id));
    }, [book.id]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [turns.length, streamText]);

    const handleGenerate = async (overrideUserText?: string) => {
        if (generating) {
            abortRef.current?.abort();
            setGenerating(false);
            return;
        }
        const actionText = (overrideUserText ?? inputText).trim();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setGenerating(true);
        setStreamText("");
        if (overrideUserText === undefined) setInputText("");

        try {
            const res = await generateSpinoffTurnCompletion({
                book,
                turns,
                userActionText: actionText,
                chapterPrompt: selectedChapterPrompt || undefined,
                signal: ctrl.signal,
                onStreamDelta: (preview) => setStreamText(preview),
            });
            if (!res.content.trim()) throw new Error("未返回有效番外正文");
            const newTurn: SpinoffTurn = {
                id: `sturn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                bookId: book.id,
                chapterLabel: selectedChapterLabel || undefined,
                userContent: actionText || (turns.length === 0 ? "（开启首幕番外）" : "（继续推进下一幕）"),
                assistantContent: res.content.trim(),
                thinkingText: res.thinking,
                createdAt: new Date().toISOString(),
            };
            const nextTurns = [...turns, newTurn];
            setTurns(nextTurns);
            saveSpinoffTurns(book.id, nextTurns);
            setSelectedChapterPrompt("");
            setSelectedChapterLabel("");
        } catch (err: any) {
            if (err?.name !== "AbortError") {
                if (actionText) setInputText(actionText);
                onToast(`生成失败：${err?.message || String(err)}`);
            }
        } finally {
            setGenerating(false);
            setStreamText("");
            abortRef.current = null;
        }
    };

    const handleRerollLast = () => {
        if (turns.length === 0 || generating) return;
        const last = turns[turns.length - 1];
        const prev = turns.slice(0, -1);
        setTurns(prev);
        saveSpinoffTurns(book.id, prev);
        const reuseText = last.userContent.startsWith("（") ? "" : last.userContent;
        void handleGenerate(reuseText);
    };

    return (
        <div className="flex flex-col h-full bg-[#f6f1e7] text-[#2b231b]">
            {/* 书籍阅读器顶栏 */}
            <header
                className="shrink-0 px-4 pb-3 border-b border-[#dfd2bc] flex items-center justify-between gap-2 bg-[#efe7d7]"
                style={{ paddingTop: "calc(var(--page-header-safe-top, 48px) + 6px)" }}
            >
                <button
                    type="button"
                    onClick={onBack}
                    className="w-9 h-9 rounded-full bg-[#2a231c]/5 flex items-center justify-center shrink-0"
                >
                    <ChevronLeft size={22} />
                </button>

                <button
                    type="button"
                    onClick={onEditMeta}
                    className="min-w-0 flex-1 flex flex-col items-center text-center"
                    title="点击修改书名或收藏归档到指定番外指令下"
                >
                    <div className="flex items-center gap-1 max-w-full">
                        <span className="text-[15px] font-bold text-[#221b14] truncate" style={{ fontFamily: 'Georgia, "Songti SC", serif' }}>
                            《{book.title}》
                        </span>
                        <Edit3 size={12} className="text-[#847259] shrink-0" />
                    </div>
                    <span className="text-[10.5px] text-[#7c6a53] truncate max-w-full">
                        {character?.name || "角色"} · {directive ? `归档于「${directive.title}」` : "点此改书名 / 归档到指令夹"}
                    </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                    {character && (
                        <button
                            type="button"
                            onClick={() => setShowStudio(true)}
                            className="w-9 h-9 rounded-full bg-[#2a231c]/5 flex items-center justify-center text-[#3d3022]"
                            title="世界书 · 思维链 · 文风配置"
                        >
                            <SlidersHorizontal size={16} />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setConfirmDeleteBook(true)}
                        className="w-9 h-9 rounded-full bg-[#2a231c]/5 flex items-center justify-center text-[#a33b3b]"
                        title="销毁此书"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </header>

            {/* 若关联的指令卷宗带有「后续章节指令」，顶部提供一键切幕胶囊 */}
            {directive && (directive.chapters?.length || 0) > 0 && (
                <div className="shrink-0 px-4 py-2 bg-[#f1e9d8] border-b border-[#e2d6c1] flex items-center gap-1.5 overflow-x-auto hide-scrollbar">
                    <span className="text-[11px] font-bold text-[#6e5c44] shrink-0">卷宗后续：</span>
                    {directive.chapters!.map((ch) => {
                        const selected = selectedChapterLabel === ch.title;
                        return (
                            <button
                                key={ch.id}
                                type="button"
                                onClick={() => {
                                    if (selected) {
                                        setSelectedChapterPrompt("");
                                        setSelectedChapterLabel("");
                                    } else {
                                        setSelectedChapterPrompt(ch.prompt);
                                        setSelectedChapterLabel(ch.title);
                                        onToast(`已装载后续幕「${ch.title}」，发送即可推进`);
                                    }
                                }}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 transition-all ${
                                    selected ? "bg-[#5e1d28] text-[#f9ebd2]" : "bg-[#fcf9f2] text-[#5c4b37] border border-[#d6c6ac]"
                                }`}
                            >
                                ✦ {ch.title}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* 书页正文滚动区 */}
            <div ref={scrollRef} className="spinoff-reader-paper flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-6">
                {/* 扉页导语卡 */}
                <div className="rounded-2xl border border-dashed border-[#d5c5aa] bg-[#fbf8f1] p-4 text-center flex flex-col gap-1.5">
                    <span className="font-mono text-[9.5px] tracking-[0.25em] text-[#8c7a61] uppercase">EX LIBRIS · APOCRYPHA</span>
                    <div className="text-[17px] font-bold text-[#221b14]" style={{ fontFamily: 'Georgia, "Songti SC", serif' }}>
                        {book.title}
                    </div>
                    {(book.subtitle || book.openingPrompt) && (
                        <p className="text-[12px] text-[#6d5d49] leading-relaxed m-0 line-clamp-4 whitespace-pre-wrap">
                            {book.subtitle || book.openingPrompt}
                        </p>
                    )}
                    <div className="pt-1 text-[10.5px] text-[#968368]">
                        平行番外阅览室 · 角色已载入完整记忆，本卷内容不会写入主线聊天总结
                    </div>
                    {turns.length === 0 && !generating && (
                        <button
                            type="button"
                            onClick={() => void handleGenerate("")}
                            className="mt-2 mx-auto px-5 py-2 rounded-full bg-[#2a231c] text-[#f7eedc] text-[12.5px] font-bold flex items-center gap-1.5 shadow-sm"
                        >
                            <Sparkles size={14} />
                            <span>直接翻开第一幕</span>
                        </button>
                    )}
                </div>

                {turns.map((turn, idx) => {
                    const cotOpen = expandedCotIds.has(turn.id);
                    return (
                        <article key={turn.id} className="flex flex-col gap-3">
                            {/* 幕次分隔线 */}
                            <div className="flex items-center gap-2 text-[11px] text-[#948166]">
                                <span className="h-[1px] flex-1 bg-[#e3d7c2]" />
                                <span className="font-mono">
                                    ACT {String(idx + 1).padStart(2, "0")}{turn.chapterLabel ? ` · ${turn.chapterLabel}` : ""}
                                </span>
                                <span className="h-[1px] flex-1 bg-[#e3d7c2]" />
                            </div>

                            {/* 用户行动旁白签 */}
                            {turn.userContent && (
                                <div className="self-end max-w-[88%] rounded-2xl rounded-tr-sm bg-[#eae0ce] px-3.5 py-2.5 text-[13px] text-[#33291e] leading-relaxed">
                                    {turn.userContent}
                                </div>
                            )}

                            {/* 角色番外叙事书页 */}
                            <div className="rounded-2xl bg-[#fcfaf5] border border-[#e5dac6] p-4 shadow-[0_4px_14px_rgba(50,35,15,0.04)] flex flex-col gap-2.5">
                                {/* 折叠思维链条 */}
                                {turn.thinkingText && (
                                    <div className="rounded-xl bg-[#f3ede0] border border-[#e2d6c0] overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setExpandedCotIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(turn.id)) next.delete(turn.id);
                                                    else next.add(turn.id);
                                                    return next;
                                                });
                                            }}
                                            className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left text-[11.5px] text-[#6b5a45]"
                                        >
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <Clock size={12} className="shrink-0" />
                                                <span className="font-semibold shrink-0">角色思维链</span>
                                                <span className="opacity-75 truncate">{turn.thinkingText.split("\n")[0]}</span>
                                            </div>
                                            <ChevronDown size={13} className={`shrink-0 transition-transform ${cotOpen ? "rotate-180" : ""}`} />
                                        </button>
                                        {cotOpen && (
                                            <div className="px-3 pb-2.5 pt-1 border-t border-[#e5dac5] text-[12px] text-[#5c4d3b] whitespace-pre-wrap leading-relaxed">
                                                {turn.thinkingText}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="text-[14.5px] leading-[1.85] text-[#261f18]" style={{ fontFamily: '"Songti SC", "Noto Serif SC", Georgia, serif' }}>
                                    <BilingualTextBlock text={turn.assistantContent} mode="markdown" defaultExpanded={false} />
                                </div>

                                {/* 书页底角操作栏 */}
                                <div className="pt-2 border-t border-[#efe7d8] flex items-center justify-between text-[11px] text-[#8f7d63]">
                                    <span>— {character?.name || "TA"}</span>
                                    <div className="flex items-center gap-3">
                                        {idx === turns.length - 1 && !generating && (
                                            <button type="button" onClick={handleRerollLast} className="flex items-center gap-1 hover:text-[#2a231c]">
                                                <RotateCcw size={12} /> 重演本幕
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setEditingTurn({ id: turn.id, userContent: turn.userContent, assistantContent: turn.assistantContent })}
                                            className="flex items-center gap-1 hover:text-[#2a231c]"
                                        >
                                            <Edit3 size={12} /> 润色
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = turns.filter(t => t.id !== turn.id);
                                                setTurns(next);
                                                saveSpinoffTurns(book.id, next);
                                            }}
                                            className="text-[#b04646]"
                                        >
                                            删除
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </article>
                    );
                })}

                {generating && (
                    <div className="rounded-2xl bg-[#fcfaf5] border border-[#e5dac6] p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-[12px] text-[#7c6a53]">
                            <Loader2 size={14} className="animate-spin" />
                            <span>正在执笔书写番外新幕...</span>
                        </div>
                        {streamText && (
                            <div className="text-[14px] leading-[1.8] text-[#261f18] whitespace-pre-wrap">
                                {streamText}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 底部行动输入栏 */}
            <div
                className="shrink-0 px-4 pt-2.5 bg-[#efe7d7] border-t border-[#dfd2bc] flex flex-col gap-1.5"
                style={{ paddingBottom: "calc(var(--ai-phone-app-safe-bottom, 16px) + 6px)" }}
            >
                {selectedChapterLabel && (
                    <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-[#5e1d28]/10 text-[#5e1d28] text-[11px] font-semibold">
                        <span>本幕已挂载后续指令：{selectedChapterLabel}</span>
                        <button type="button" onClick={() => { setSelectedChapterLabel(""); setSelectedChapterPrompt(""); }}>
                            <X size={13} />
                        </button>
                    </div>
                )}
                <div className="flex items-end gap-2">
                    <textarea
                        rows={1}
                        value={inputText}
                        onChange={e => {
                            setInputText(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = Math.min(e.target.scrollHeight, 110) + "px";
                        }}
                        placeholder="写下你的动作、台词或剧情走向（留空点发送可直接让TA顺延推进）..."
                        className="flex-1 rounded-2xl bg-[#fcf9f2] border border-[#d6c6ac] px-3.5 py-2.5 text-[13.5px] text-[#241d16] outline-none resize-none"
                    />
                    <button
                        type="button"
                        onClick={() => void handleGenerate()}
                        className={`h-10 px-4 rounded-2xl font-bold text-[12.5px] flex items-center justify-center gap-1 shrink-0 transition-all ${
                            generating ? "bg-[#a33b3b] text-white" : "bg-[#2a231c] text-[#f7eedc]"
                        }`}
                    >
                        {generating ? "停止" : <><Send size={14} /><span>推进</span></>}
                    </button>
                </div>
            </div>

            {/* 润色单幕弹窗 */}
            {editingTurn && (
                <div className="modal-overlay" onClick={() => setEditingTurn(null)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">润色本幕番外</span>
                        <label className="ts-11 text-[var(--c-icon)] self-start">你的行动 / 引子</label>
                        <textarea
                            rows={2}
                            value={editingTurn.userContent}
                            onChange={e => setEditingTurn({ ...editingTurn, userContent: e.target.value })}
                            className="ui-textarea ts-12"
                        />
                        <label className="ts-11 text-[var(--c-icon)] self-start">番外正文</label>
                        <textarea
                            rows={8}
                            value={editingTurn.assistantContent}
                            onChange={e => setEditingTurn({ ...editingTurn, assistantContent: e.target.value })}
                            className="ui-textarea ts-13 leading-relaxed"
                        />
                        <div className="flex gap-2 w-full">
                            <button type="button" className="ui-btn ui-btn-ghost flex-1" onClick={() => setEditingTurn(null)}>取消</button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary flex-1"
                                onClick={() => {
                                    const next = turns.map(t =>
                                        t.id === editingTurn.id
                                            ? { ...t, userContent: editingTurn.userContent, assistantContent: editingTurn.assistantContent }
                                            : t,
                                    );
                                    setTurns(next);
                                    saveSpinoffTurns(book.id, next);
                                    setEditingTurn(null);
                                    onToast("已保存润色内容");
                                }}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showStudio && character && (
                <SpinoffStudioModal
                    character={character}
                    onClose={() => setShowStudio(false)}
                    onToast={onToast}
                />
            )}

            {confirmDeleteBook && (
                <div className="modal-overlay" onClick={() => setConfirmDeleteBook(false)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">销毁《{book.title}》？</span>
                        <p className="ts-13 text-[var(--c-text)] opacity-80 text-center">
                            销毁后这册番外卷宗内的全部章节将无法恢复（不影响主线聊天与番外指令模板）。
                        </p>
                        <div className="flex gap-2 w-full">
                            <button type="button" className="ui-btn ui-btn-ghost flex-1" onClick={() => setConfirmDeleteBook(false)}>取消</button>
                            <button type="button" className="ui-btn ui-btn-danger flex-1" onClick={onDeleted}>确认销毁</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
   番外馆弹窗群：收编指令弹窗 / 开启新书弹窗 / 书名与指令收藏编辑弹窗 / 番外场记配置台
   ════════════════════════════════════════════════════════════════ */

function DirectiveEditorModal({
    draft,
    folders,
    onChange,
    onClose,
    onSave,
}: {
    draft: {
        id?: string;
        folderId: string;
        title: string;
        premise: string;
        prompt: string;
        chapters: SpinoffDirectiveChapter[];
    };
    folders: SpinoffFolder[];
    onChange: (next: typeof draft) => void;
    onClose: () => void;
    onSave: () => void;
}) {
    const addChapter = () => {
        onChange({
            ...draft,
            chapters: [
                ...draft.chapters,
                {
                    id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                    title: `后续第 ${draft.chapters.length + 1} 幕`,
                    prompt: "",
                },
            ],
        });
    };

    return (
        <div className="modal-overlay modal-overlay-bottom" onClick={onClose}>
            <div className="modal-sheet max-h-[86vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <button type="button" onClick={onClose} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                    <span className="modal-header-title">{draft.id ? "编辑番外指令档案" : "收编新番外指令"}</span>
                    <button type="button" onClick={onSave} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                </div>

                <div className="modal-body hide-scrollbar flex flex-col gap-3.5 pb-8">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">归属分类卷夹</label>
                        <select
                            value={draft.folderId}
                            onChange={e => onChange({ ...draft, folderId: e.target.value })}
                            className="ui-select"
                        >
                            {folders.map(f => (
                                <option key={f.id} value={f.id}>📁 {f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">剧场指令标题</label>
                        <Input
                            type="text"
                            value={draft.title}
                            onChange={e => onChange({ ...draft, title: e.target.value })}
                            placeholder="例如：酒后吐真言 · 初雪便利店"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">一句话梗概（选填，展示在卷宗封面）</label>
                        <Input
                            type="text"
                            value={draft.premise}
                            onChange={e => onChange({ ...draft, premise: e.target.value })}
                            placeholder="简述这一幕番外的氛围与前提..."
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">主幕指令正文（将喂给角色开启番外）</label>
                        <textarea
                            rows={5}
                            value={draft.prompt}
                            onChange={e => onChange({ ...draft, prompt: e.target.value })}
                            placeholder="写下完整的小剧场背景、情境设定或互动指令..."
                            className="ui-textarea"
                        />
                    </div>

                    {/* 系列后续章节（同一档案下收纳连续后续） */}
                    <div className="flex flex-col gap-2 pt-1 border-t border-[var(--c-border)]">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">同档案后续章节</span>
                                <span className="ts-11 text-[var(--c-icon)]">有连续后续的小剧场可收纳在同一份指令档案里</span>
                            </div>
                            <button
                                type="button"
                                onClick={addChapter}
                                className="px-3 py-1.5 rounded-full bg-black text-white ts-11 font-semibold flex items-center gap-1"
                            >
                                <Plus size={12} /> 加后续幕
                            </button>
                        </div>

                        {draft.chapters.map((ch, idx) => (
                            <div key={ch.id} className="rounded-xl bg-[var(--c-input)] p-3 flex flex-col gap-2">
                                <div className="flex items-center justify-between gap-2">
                                    <Input
                                        type="text"
                                        value={ch.title}
                                        onChange={e => {
                                            const next = [...draft.chapters];
                                            next[idx] = { ...ch, title: e.target.value };
                                            onChange({ ...draft, chapters: next });
                                        }}
                                        placeholder="后续幕标题"
                                        className="flex-1 ts-12"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => onChange({ ...draft, chapters: draft.chapters.filter(item => item.id !== ch.id) })}
                                        className="text-[var(--c-danger)] p-1"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                <textarea
                                    rows={3}
                                    value={ch.prompt}
                                    onChange={e => {
                                        const next = [...draft.chapters];
                                        next[idx] = { ...ch, prompt: e.target.value };
                                        onChange({ ...draft, chapters: next });
                                    }}
                                    placeholder="这一幕后续的推进指令..."
                                    className="ui-textarea ts-12"
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function NewBookLaunchModal({
    state,
    characters,
    directives,
    onChange,
    onClose,
    onConfirm,
}: {
    state: {
        characterId: string;
        directiveId?: string;
        title: string;
        subtitle: string;
        openingPrompt: string;
        spineTone: SpinoffBookTone;
    };
    characters: Character[];
    directives: SpinoffDirective[];
    onChange: (next: typeof state) => void;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="modal-overlay modal-overlay-bottom" onClick={onClose}>
            <div className="modal-sheet max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <button type="button" onClick={onClose} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                    <span className="modal-header-title">装帧新番外卷宗</span>
                    <button type="button" onClick={onConfirm} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                </div>

                <div className="modal-body hide-scrollbar flex flex-col gap-3.5 pb-8">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">出演角色</label>
                        <select
                            value={state.characterId}
                            onChange={e => onChange({ ...state, characterId: e.target.value })}
                            className="ui-select"
                        >
                            {characters.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">选用收藏的番外指令（可选 · 也可直接自由手写）</label>
                        <select
                            value={state.directiveId || ""}
                            onChange={e => {
                                const dirId = e.target.value || undefined;
                                const dir = directives.find(d => d.id === dirId);
                                onChange({
                                    ...state,
                                    directiveId: dirId,
                                    title: dir ? dir.title : state.title,
                                    subtitle: dir ? dir.premise : state.subtitle,
                                    openingPrompt: dir ? dir.prompt : state.openingPrompt,
                                });
                            }}
                            className="ui-select"
                        >
                            <option value="">— 自由番外（不绑定特定指令模板） —</option>
                            {directives.map(d => (
                                <option key={d.id} value={d.id}>🎬 {d.title}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">精装书名（随时可改）</label>
                        <Input
                            type="text"
                            value={state.title}
                            onChange={e => onChange({ ...state, title: e.target.value })}
                            placeholder="为这册番外起一个书名..."
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">书封色调装帧</label>
                        <div className="grid grid-cols-3 gap-2">
                            {(Object.keys(BOOK_TONE_PALETTE) as SpinoffBookTone[]).map(tone => {
                                const p = BOOK_TONE_PALETTE[tone];
                                const active = state.spineTone === tone;
                                return (
                                    <button
                                        key={tone}
                                        type="button"
                                        onClick={() => onChange({ ...state, spineTone: tone })}
                                        className={`px-2.5 py-2 rounded-xl text-[11.5px] font-bold flex items-center justify-between border transition-all ${
                                            active ? "ring-2 ring-black" : "border-transparent"
                                        }`}
                                        style={{ background: p.bg, color: p.foil }}
                                    >
                                        <span>{p.label}</span>
                                        {active && <Check size={13} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">本卷开篇情境 / 番外指令</label>
                        <textarea
                            rows={5}
                            value={state.openingPrompt}
                            onChange={e => onChange({ ...state, openingPrompt: e.target.value })}
                            placeholder="写下这一卷番外的背景设定、特殊前提或开场要求..."
                            className="ui-textarea"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function BookMetaModal({
    book,
    directives,
    onClose,
    onSave,
}: {
    book: SpinoffBook;
    directives: SpinoffDirective[];
    onClose: () => void;
    onSave: (patch: Partial<Pick<SpinoffBook, "title" | "subtitle" | "directiveId" | "spineTone" | "openingPrompt">>) => void;
}) {
    const [title, setTitle] = useState(book.title);
    const [subtitle, setSubtitle] = useState(book.subtitle || "");
    const [directiveId, setDirectiveId] = useState(book.directiveId || "");
    const [spineTone, setSpineTone] = useState<SpinoffBookTone>(book.spineTone || "burgundy");
    const [openingPrompt, setOpeningPrompt] = useState(book.openingPrompt || "");

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-dialog max-h-[84vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <span className="modal-header-title">修改藏书名与指令收藏归档</span>

                <div className="flex flex-col gap-1 w-full">
                    <label className="ts-11 text-[var(--c-icon)]">书名（显示在角色书架封面上）</label>
                    <Input type="text" value={title} onChange={e => setTitle(e.target.value)} />
                </div>

                <div className="flex flex-col gap-1 w-full">
                    <label className="ts-11 text-[var(--c-icon)]">副标题 / 题记</label>
                    <Input type="text" value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="选填..." />
                </div>

                <div className="flex flex-col gap-1 w-full">
                    <label className="ts-11 text-[var(--c-icon)]">收藏归档到哪条「番外指令」卷宗下</label>
                    <select
                        value={directiveId}
                        onChange={e => setDirectiveId(e.target.value)}
                        className="ui-select"
                    >
                        <option value="">不归入特定指令（仅存角色个人藏书阁）</option>
                        {directives.map(d => (
                            <option key={d.id} value={d.id}>🎬 {d.title}</option>
                        ))}
                    </select>
                </div>

                <div className="flex flex-col gap-1 w-full">
                    <label className="ts-11 text-[var(--c-icon)]">更换精装封面色</label>
                    <div className="grid grid-cols-3 gap-1.5">
                        {(Object.keys(BOOK_TONE_PALETTE) as SpinoffBookTone[]).map(tone => {
                            const p = BOOK_TONE_PALETTE[tone];
                            return (
                                <button
                                    key={tone}
                                    type="button"
                                    onClick={() => setSpineTone(tone)}
                                    className={`px-2 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-between ${spineTone === tone ? "ring-2 ring-black" : ""}`}
                                    style={{ background: p.bg, color: p.foil }}
                                >
                                    <span>{p.label}</span>
                                    {spineTone === tone && <Check size={12} />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-col gap-1 w-full">
                    <label className="ts-11 text-[var(--c-icon)]">开篇设定备份</label>
                    <textarea
                        rows={3}
                        value={openingPrompt}
                        onChange={e => setOpeningPrompt(e.target.value)}
                        className="ui-textarea ts-12"
                    />
                </div>

                <div className="flex gap-2 w-full pt-1">
                    <button type="button" className="ui-btn ui-btn-ghost flex-1" onClick={onClose}>取消</button>
                    <button
                        type="button"
                        className="ui-btn ui-btn-primary flex-1"
                        onClick={() => onSave({
                            title,
                            subtitle,
                            directiveId: directiveId || undefined,
                            spineTone,
                            openingPrompt,
                        })}
                    >
                        保存修改
                    </button>
                </div>
            </div>
        </div>
    );
}

/** 番外馆专属场记配置台：同样支持独立世界书单条开关 + 共享思维链预设库 + 共享文风预设库 */
function SpinoffStudioModal({
    character,
    onClose,
    onToast,
}: {
    character: Character;
    onClose: () => void;
    onToast: (msg: string) => void;
}) {
    const [tab, setTab] = useState<"preset" | "wb" | "cot" | "style">("preset");
    const [cfg, setCfg] = useState<SpinoffCharacterStudioConfig>(() => loadSpinoffCharStudio(character.id));
    const [presets] = useState(() => loadPresets());
    const [regexes] = useState(() => loadRegexes());
    const [worldBooks] = useState(() => loadWorldBooks());
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
    const [cotPresets, setCotPresets] = useState(() => loadOfflineCotPresets());
    const [stylePresets, setStylePresets] = useState(() => loadOfflineStylePresets());
    const [cotName, setCotName] = useState("");
    const [styleName, setStyleName] = useState("");

    const update = (patch: Partial<SpinoffCharacterStudioConfig>) => {
        const next = { ...cfg, ...patch };
        setCfg(next);
        saveSpinoffCharStudio(character.id, next);
    };

    const toggleIndependentWb = (enabled: boolean) => {
        if (enabled && (!cfg.worldBookIds || cfg.worldBookIds.length === 0)) {
            const slot = resolveBinding(loadBindingConfig(), character.id, "spinoff");
            update({
                useIndependentWorldBooks: true,
                worldBookIds: slot.worldBookIds ? [...slot.worldBookIds] : [],
            });
            return;
        }
        update({ useIndependentWorldBooks: enabled });
    };

    const selectedWbIds = cfg.worldBookIds || [];
    const selectedRegexIds = cfg.regexIds || [];
    const overrides = cfg.worldBookEntryOverrides || {};

    return (
        <div className="fixed inset-0 z-[10060] flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
            <div
                className="flex max-h-[84vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-[var(--c-page-body-bg)] text-[var(--c-text)] shadow-2xl sm:rounded-3xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 pt-4 pb-2.5 border-b border-black/5">
                    <div className="flex flex-col">
                        <span className="font-mono text-[10px] tracking-widest text-[var(--c-icon)]">APOCRYPHA STUDIO</span>
                        <span className="ts-15 font-bold text-[var(--c-text-title)]">{character.name} · 番外场记配置</span>
                    </div>
                    <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center">
                        <X size={16} />
                    </button>
                </div>

                <div className="grid grid-cols-4 gap-1.5 px-4 py-2.5 bg-[var(--c-card)]/60 border-b border-black/5">
                    {([
                        { id: "preset", label: "预设正则", icon: SlidersHorizontal },
                        { id: "wb", label: "世界书", icon: BookOpen },
                        { id: "cot", label: "思维链", icon: Brain },
                        { id: "style", label: "文风", icon: Feather },
                    ] as const).map(item => {
                        const Icon = item.icon;
                        const active = tab === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setTab(item.id)}
                                className={`py-2 rounded-xl ts-11 font-semibold flex flex-col items-center justify-center gap-1 ${
                                    active ? "bg-black text-white" : "bg-[var(--c-input)] text-[var(--c-text)]"
                                }`}
                            >
                                <Icon size={14} />
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-3">
                    {tab === "preset" && (
                        <>
                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col pr-3">
                                        <span className="ts-13 font-bold text-[var(--c-text-title)]">流式实时输出</span>
                                        <span className="ts-11 text-[var(--c-icon)]">开启后逐字展开番外书页正文</span>
                                    </div>
                                    <Toggle checked={cfg.streamEnabled !== false} onChange={v => update({ streamEnabled: v })} />
                                </div>
                            </div>

                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">番外专用预设（支持「线下专属」分组）</span>
                                <span className="ts-11 text-[var(--c-icon)]">可为此角色的番外馆单独指定酒馆导入的线下预设，不影响线上聊天</span>
                                <select
                                    value={cfg.presetId || ""}
                                    onChange={e => update({ presetId: e.target.value || undefined })}
                                    className="ui-select ts-12"
                                >
                                    <option value="">— 跟随角色绑定配置 —</option>
                                    {presets.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.presetGroup === "offline" ? `[线下专属] ${p.name}` : p.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5 flex flex-col gap-2">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">附加正则组（支持「线下专属」正则）</span>
                                {regexes.length === 0 ? (
                                    <span className="ts-11 text-[var(--c-icon)]">暂无可用正则组</span>
                                ) : (
                                    <div className="flex flex-col gap-1.5 max-h-[210px] overflow-y-auto">
                                        {regexes.map(rx => {
                                            const checked = selectedRegexIds.includes(rx.id);
                                            return (
                                                <button
                                                    key={rx.id}
                                                    type="button"
                                                    onClick={() => {
                                                        const next = checked
                                                            ? selectedRegexIds.filter(id => id !== rx.id)
                                                            : [...selectedRegexIds, rx.id];
                                                        update({ regexIds: next });
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

                    {tab === "wb" && (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5">
                                <div className="flex flex-col pr-3">
                                    <span className="ts-13 font-bold text-[var(--c-text-title)]">番外独立世界书开关</span>
                                    <span className="ts-11 text-[var(--c-icon)]">仅作用于该角色的番外馆演绎，不影响主线线上与线下</span>
                                </div>
                                <Toggle checked={Boolean(cfg.useIndependentWorldBooks)} onChange={toggleIndependentWb} />
                            </div>
                            {worldBooks.map(wb => {
                                const checked = selectedWbIds.includes(wb.id);
                                const expanded = expandedIds.has(wb.id);
                                return (
                                    <div key={wb.id} className="rounded-2xl bg-[var(--c-card)] border border-black/5 overflow-hidden">
                                        <div className="flex items-center justify-between px-3.5 py-2.5">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const next = checked ? selectedWbIds.filter(id => id !== wb.id) : [...selectedWbIds, wb.id];
                                                    update({ useIndependentWorldBooks: true, worldBookIds: next });
                                                }}
                                                className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                                            >
                                                <span className={`w-5 h-5 rounded-md flex items-center justify-center border ${checked ? "bg-black border-black text-white" : "border-black/20"}`}>
                                                    {checked && <Check size={13} />}
                                                </span>
                                                <span className="ts-13 font-bold text-[var(--c-text-title)] truncate">{wb.name}</span>
                                            </button>
                                            {wb.entries.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setExpandedIds(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(wb.id)) next.delete(wb.id);
                                                            else next.add(wb.id);
                                                            return next;
                                                        });
                                                    }}
                                                    className="px-2 py-1 rounded-lg bg-[var(--c-input)] ts-11 flex items-center gap-1"
                                                >
                                                    <span>条目 ({wb.entries.length})</span>
                                                    <ChevronDown size={13} className={expanded ? "rotate-180" : ""} />
                                                </button>
                                            )}
                                        </div>
                                        {expanded && (
                                            <div className="border-t border-black/5 bg-[var(--c-input)]/40 px-3 py-2 flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
                                                {wb.entries.map(entry => {
                                                    const key = `${wb.id}:${entry.uid}`;
                                                    const on = key in overrides ? overrides[key] : !entry.disable;
                                                    return (
                                                        <div key={entry.uid} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--c-card)] px-2.5 py-1.5">
                                                            <span className="ts-12 truncate">{entry.comment || entry.key || "条目"}</span>
                                                            <Toggle
                                                                checked={on}
                                                                onChange={val => update({
                                                                    useIndependentWorldBooks: true,
                                                                    worldBookEntryOverrides: { ...overrides, [key]: val },
                                                                })}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </>
                    )}

                    {tab === "cot" && (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">番外回复附带折叠思维链</span>
                                <Toggle checked={cfg.cotEnabled !== false} onChange={v => update({ cotEnabled: v })} />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {cotPresets.map(p => (
                                    <div key={p.id} className="inline-flex items-center rounded-full overflow-hidden border border-black/10">
                                        <button
                                            type="button"
                                            onClick={() => update({ cotEnabled: true, cotPresetId: p.id, cotPrompt: p.content, cotTag: p.tag || "thinking" })}
                                            className={`px-3 py-1 ts-11 font-medium ${cfg.cotPresetId === p.id ? "bg-black text-white" : "bg-[var(--c-input)]"}`}
                                        >
                                            {p.name}
                                        </button>
                                        {!p.builtIn && (
                                            <button
                                                type="button"
                                                onClick={() => { deleteOfflineCotPreset(p.id); setCotPresets(loadOfflineCotPresets()); }}
                                                className="px-1.5 py-1 bg-[var(--c-input)] text-[var(--c-danger)]"
                                            >
                                                <Trash2 size={11} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <textarea
                                rows={6}
                                value={cfg.cotPrompt ?? DEFAULT_COT_PRESETS[0].content}
                                onChange={e => update({ cotPrompt: e.target.value })}
                                className="ui-textarea ts-12"
                            />
                            <div className="flex gap-2">
                                <Input type="text" value={cotName} onChange={e => setCotName(e.target.value)} placeholder="新思维链预设名..." className="flex-1 ts-12" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const saved = upsertOfflineCotPreset({
                                            name: cotName.trim() || "番外思维链",
                                            content: cfg.cotPrompt || DEFAULT_COT_PRESETS[0].content,
                                        });
                                        setCotPresets(loadOfflineCotPresets());
                                        update({ cotPresetId: saved.id, cotEnabled: true });
                                        onToast(`已保存预设「${saved.name}」`);
                                    }}
                                    className="ui-btn ui-btn-primary px-3 rounded-xl ts-12 flex items-center gap-1"
                                >
                                    <Save size={13} /> 保存预设
                                </button>
                            </div>
                        </>
                    )}

                    {tab === "style" && (
                        <>
                            <div className="flex items-center justify-between rounded-2xl bg-[var(--c-card)] p-3.5 border border-black/5">
                                <span className="ts-13 font-bold text-[var(--c-text-title)]">启用番外文风约束</span>
                                <Toggle
                                    checked={Boolean(cfg.styleEnabled)}
                                    onChange={v => update({ styleEnabled: v, stylePrompt: cfg.stylePrompt || DEFAULT_STYLE_PRESETS[0].content })}
                                />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {stylePresets.map(p => (
                                    <div key={p.id} className="inline-flex items-center rounded-full overflow-hidden border border-black/10">
                                        <button
                                            type="button"
                                            onClick={() => update({ styleEnabled: true, stylePresetId: p.id, stylePrompt: p.content })}
                                            className={`px-3 py-1 ts-11 font-medium ${cfg.stylePresetId === p.id ? "bg-black text-white" : "bg-[var(--c-input)]"}`}
                                        >
                                            {p.name}
                                        </button>
                                        {!p.builtIn && (
                                            <button
                                                type="button"
                                                onClick={() => { deleteOfflineStylePreset(p.id); setStylePresets(loadOfflineStylePresets()); }}
                                                className="px-1.5 py-1 bg-[var(--c-input)] text-[var(--c-danger)]"
                                            >
                                                <Trash2 size={11} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <textarea
                                rows={6}
                                value={cfg.stylePrompt ?? DEFAULT_STYLE_PRESETS[0].content}
                                onChange={e => update({ stylePrompt: e.target.value })}
                                className="ui-textarea ts-12"
                            />
                            <div className="flex gap-2">
                                <Input type="text" value={styleName} onChange={e => setStyleName(e.target.value)} placeholder="新文风预设名..." className="flex-1 ts-12" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const saved = upsertOfflineStylePreset({
                                            name: styleName.trim() || "番外文风",
                                            content: cfg.stylePrompt || DEFAULT_STYLE_PRESETS[0].content,
                                        });
                                        setStylePresets(loadOfflineStylePresets());
                                        update({ stylePresetId: saved.id, styleEnabled: true });
                                        onToast(`已保存文风预设「${saved.name}」`);
                                    }}
                                    className="ui-btn ui-btn-primary px-3 rounded-xl ts-12 flex items-center gap-1"
                                >
                                    <Save size={13} /> 保存预设
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function SpinoffToast({ text }: { text: string }) {
    return (
        <div className="fixed bottom-24 inset-x-0 z-[10090] flex justify-center pointer-events-none">
            <div className="px-4 py-2 rounded-full bg-[#2a231c]/90 text-[#f7eedc] text-[12px] font-medium shadow-lg">
                {text}
            </div>
        </div>
    );
}
