"use client";

import { useState, useEffect, useCallback, useContext } from "react";
import { Plus, User, Trash2, FileEdit, AlertCircle, Camera, Link, X, Check } from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import { loadUserIdentities, saveUserIdentities } from "@/lib/settings-storage";
import { Input } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";

export type UserIdentity = {
    id: string;
    name: string;
    /** 备注：角色绑定或切换面具时优先显示备注，没有备注再显示全名 */
    remark?: string;
    avatarUrl?: string;
    bio: string;
    gender: string;
    age: string;
    occupation: string;
    customSettings: string;
};

/** 优先显示面具备注，无备注则回退显示名字 */
export function getUserIdentityDisplayName(identity?: Pick<UserIdentity, "name" | "remark"> | null, fallback = "未命名身份"): string {
    if (!identity) return fallback;
    const remark = identity.remark?.trim();
    if (remark) return remark;
    const name = identity.name?.trim();
    return name || fallback;
}

const DEFAULT_IDENTITIES: UserIdentity[] = [
    {
        id: "identity-1",
        name: "李斯特",
        bio: "一个普通的上班族，喜欢在周末去咖啡馆看书。",
        gender: "男",
        age: "26",
        occupation: "程序员",
        customSettings: "性格温和，说话带有一点理性逻辑。",
    },
    {
        id: "identity-2",
        name: "匿名用户",
        bio: "神秘的过客。",
        gender: "保密",
        age: "未知",
        occupation: "自由职业者",
        customSettings: "说话简短，带有神秘色彩。",
    }
];

function fileToDataUrl(file: File, maxSize = 400, quality = 0.8): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/webp", quality));
            };
            img.onerror = reject;
            img.src = reader.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function UserIdentitySettings() {
    const { setSubpageRightAction } = useContext(SettingsContext);
    const [identities, setIdentitiesRaw] = useState<UserIdentity[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewIdentity, setIsNewIdentity] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    useEffect(() => {
        const saved = loadUserIdentities();
        if (saved.length > 0) {
            setIdentitiesRaw(saved);
        } else {
            setIdentitiesRaw(DEFAULT_IDENTITIES);
            saveUserIdentities(DEFAULT_IDENTITIES);
        }
    }, []);

    const setIdentities = useCallback((next: UserIdentity[]) => {
        setIdentitiesRaw(next);
        saveUserIdentities(next);
    }, []);

    const addIdentity = useCallback(() => {
        const newIdentity: UserIdentity = {
            id: `identity-${Date.now()}`,
            name: "新身份",
            bio: "",
            gender: "保密",
            age: "",
            occupation: "",
            customSettings: "",
        };
        const next = [newIdentity, ...identities];
        setIdentities(next);
        setIsNewIdentity(true);
        setEditingId(newIdentity.id);
    }, [identities, setIdentities]);

    useEffect(() => {
        setSubpageRightAction("identity",
            <button
                onClick={addIdentity}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增身份</span>
            </button>
        );
        return () => setSubpageRightAction("identity", null);
    }, [addIdentity, setSubpageRightAction]);

    const updateIdentity = (id: string, updates: Partial<UserIdentity>) => {
        setIdentities(identities.map(i => i.id === id ? { ...i, ...updates } : i));
    };

    const removeIdentity = (id: string) => {
        const next = identities.filter(i => i.id !== id);
        setIdentities(next);
        if (editingId === id) {
            setEditingId(null);
            setIsNewIdentity(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">User Identity</h2>
            </div>

            {identities.length === 0 ? (
                <div className="ui-empty">
                    <div className="ui-icon-circle">
                        <User size={24} />
                    </div>
                    <span className="menu-label font-semibold">没有身份卡片</span>
                    <span className="menu-desc max-w-[240px]">
                        在此管理您的个人身份信息，以便 AI 能够更好地了解您。
                    </span>
                    <button onClick={addIdentity} className="ui-btn ui-btn-primary rounded-[20px] mt-2">
                        <Plus size={16} /> 添加身份
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {identities.map((identity, idx) => {
                        const remarkTitle = getUserIdentityDisplayName(identity);
                        const hasRemark = Boolean(identity.remark?.trim());
                        return (
                            <div
                                key={identity.id}
                                className="ui-config-card min-w-0 cursor-pointer relative flex flex-col justify-between rounded-2xl border border-black/10 bg-[var(--c-card)] p-3 shadow-sm transition-all hover:shadow-md"
                                style={{ minHeight: 136 }}
                                role="button"
                                tabIndex={0}
                                aria-label={`编辑 ${remarkTitle}`}
                                onClick={() => setEditingId(identity.id)}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setEditingId(identity.id);
                                    }
                                }}
                            >
                                {/* 档案头编号栏 */}
                                <div className="flex items-center justify-between border-b border-dashed border-black/15 pb-1.5 mb-2">
                                    <span className="font-mono text-[10px] tracking-wider text-[var(--c-icon)] uppercase">
                                        DOS // {String(idx + 1).padStart(2, "0")}
                                    </span>
                                    <span className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-[var(--c-text)]">
                                        {identity.gender || "保密"}
                                    </span>
                                </div>

                                {/* 完整相框头像 + 备注/姓名 */}
                                <div className="flex items-center gap-2.5 min-w-0 my-auto">
                                    <div className="h-11 w-11 rounded-xl border border-black/10 bg-[var(--c-page-body-bg)] overflow-hidden shrink-0 flex items-center justify-center shadow-inner">
                                        {identity.avatarUrl ? (
                                            <img src={identity.avatarUrl} alt={identity.name} className="h-full w-full object-cover" />
                                        ) : (
                                            <User size={20} className="text-[var(--c-icon)]" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                        <span className="truncate text-[calc(14px*var(--app-text-scale,1))] font-bold leading-snug text-[var(--c-text-title)]">
                                            {remarkTitle}
                                        </span>
                                        <span className="truncate text-[calc(11px*var(--app-text-scale,1))] text-[var(--c-icon)]">
                                            {hasRemark ? `姓名：${identity.name || "未填"}` : (identity.occupation || "未填身份")}
                                        </span>
                                    </div>
                                </div>

                                {/* 底部元信息 + 按钮 */}
                                <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-black/5">
                                    <span className="truncate text-[calc(10.5px*var(--app-text-scale,1))] text-[var(--c-icon)]">
                                        {[identity.age ? `${identity.age}岁` : "", identity.occupation].filter(Boolean).join(" · ") || "档案卡"}
                                    </span>
                                    <div className="flex gap-1.5 shrink-0 items-center">
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setEditingId(identity.id);
                                            }}
                                            className="ui-link-btn"
                                        >
                                            <FileEdit size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setConfirmDeleteId(identity.id);
                                            }}
                                            className="ui-link-btn"
                                            data-variant="danger"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {editingId && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => { if (isNewIdentity && editingId) removeIdentity(editingId); setIsNewIdentity(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{isNewIdentity ? "添加身份" : "编辑身份"}</span>
                            <button onClick={() => { setIsNewIdentity(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>

                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            {(() => {
                                const identity = identities.find(c => c.id === editingId);
                                if (!identity) return null;
                                return (
                                    <div className="rounded-2xl border border-black/15 bg-[var(--c-card)] p-4 flex flex-col gap-4 shadow-sm">
                                        {/* 档案夹页眉 */}
                                        <div className="flex items-center justify-between border-b-2 border-dotted border-black/20 pb-2.5">
                                            <div className="flex flex-col">
                                                <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--c-icon)] uppercase">
                                                    // PERSONNEL DOSSIER
                                                </span>
                                                <span className="ts-15 font-bold text-[var(--c-text-title)]">
                                                    身份面具档案卡
                                                </span>
                                            </div>
                                            <span className="font-mono text-[11px] px-2 py-0.5 rounded-full border border-black/15 text-[var(--c-icon)]">
                                                #{identity.id.slice(-6).toUpperCase()}
                                            </span>
                                        </div>

                                        {/* 上半部：左立绘相框 + 右核心登记栏 */}
                                        <div className="flex gap-3.5 items-start">
                                            <div className="flex flex-col items-center gap-1.5 shrink-0">
                                                <div
                                                    onClick={() => {
                                                        const input = document.createElement("input");
                                                        input.type = "file";
                                                        input.accept = "image/*";
                                                        input.onchange = async () => {
                                                            const file = input.files?.[0];
                                                            if (!file) return;
                                                            try {
                                                                const dataUrl = await fileToDataUrl(file);
                                                                updateIdentity(identity.id, { avatarUrl: dataUrl });
                                                            } catch { /* ignore */ }
                                                        };
                                                        input.click();
                                                    }}
                                                    className="relative w-[92px] h-[114px] rounded-xl border-2 border-black/15 bg-[var(--c-page-body-bg)] p-1.5 shadow-sm cursor-pointer flex flex-col items-center justify-center overflow-hidden"
                                                >
                                                    <div className="w-6 h-1.5 rounded-full bg-black/20 mb-1 shrink-0" />
                                                    <div className="w-full flex-1 rounded-lg overflow-hidden bg-black/5 flex flex-col items-center justify-center relative">
                                                        {identity.avatarUrl ? (
                                                            <>
                                                                <img src={identity.avatarUrl} alt="" className="w-full h-full object-cover" />
                                                                <div className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 flex justify-center">
                                                                    <Camera size={12} color="#fff" />
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <User size={24} className="text-[var(--c-icon)]" />
                                                                <span className="text-[10px] mt-1 text-[var(--c-icon)]">上传相片</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 w-[92px]">
                                                    <Input
                                                        type="text"
                                                        value={identity.avatarUrl?.startsWith("data:") ? "" : (identity.avatarUrl || "")}
                                                        onChange={(e) => updateIdentity(identity.id, { avatarUrl: e.target.value })}
                                                        placeholder="粘贴图链..."
                                                        className="w-full text-[10px] px-1.5 py-1"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                                                <div className="flex flex-col gap-0.5 border-b border-dashed border-black/15 pb-1.5">
                                                    <label className="font-mono text-[10px] text-[var(--c-icon)]">▪ 面具备注 (仅自己分辨 · 角色不可见)</label>
                                                    <Input
                                                        type="text"
                                                        value={identity.remark || ""}
                                                        onChange={(e) => updateIdentity(identity.id, { remark: e.target.value })}
                                                        placeholder="如：现代线 / 某角色专属"
                                                        className="font-semibold"
                                                    />
                                                </div>
                                                <div className="flex gap-2">
                                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                                        <label className="font-mono text-[10px] text-[var(--c-icon)]">▪ 真实名称 (AI称呼)</label>
                                                        <Input
                                                            type="text"
                                                            value={identity.name}
                                                            onChange={(e) => updateIdentity(identity.id, { name: e.target.value })}
                                                            placeholder="AI对您的称呼"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 w-[78px] shrink-0">
                                                        <label className="font-mono text-[10px] text-[var(--c-icon)]">▪ 性别</label>
                                                        <select
                                                            value={identity.gender}
                                                            onChange={(e) => updateIdentity(identity.id, { gender: e.target.value })}
                                                            className="ui-select"
                                                        >
                                                            <option value="保密">保密</option>
                                                            <option value="男">男</option>
                                                            <option value="女">女</option>
                                                            <option value="其他">其他</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                                        <label className="font-mono text-[10px] text-[var(--c-icon)]">▪ 年龄</label>
                                                        <input
                                                            type="text"
                                                            value={identity.age}
                                                            onChange={(e) => updateIdentity(identity.id, { age: e.target.value })}
                                                            placeholder="如: 22"
                                                            className="ui-input"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                                        <label className="font-mono text-[10px] text-[var(--c-icon)]">▪ 身份/职业</label>
                                                        <input
                                                            type="text"
                                                            value={identity.occupation}
                                                            onChange={(e) => updateIdentity(identity.id, { occupation: e.target.value })}
                                                            placeholder="如: 学生"
                                                            className="ui-input"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* 下半部：虚线框档案正文 */}
                                        <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-black/20 p-3 bg-black/[0.015]">
                                            <div className="flex items-center justify-between">
                                                <label className="font-mono text-[11px] font-bold text-[var(--c-text-title)]">▪ 基础背景档案 // BIO</label>
                                                <span className="font-mono text-[10px] text-[var(--c-icon)]">BACKGROUND</span>
                                            </div>
                                            <textarea
                                                value={identity.bio}
                                                onChange={(e) => updateIdentity(identity.id, { bio: e.target.value })}
                                                placeholder="简单描述一下自己，这会作为AI了解您的基础背景..."
                                                rows={3}
                                                className="ui-textarea bg-transparent"
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-black/20 p-3 bg-black/[0.015]">
                                            <div className="flex items-center justify-between">
                                                <label className="font-mono text-[11px] font-bold text-[var(--c-text-title)]">▪ 深度性格与附加设定 // DIRECTIVES</label>
                                                <span className="font-mono text-[10px] text-[var(--c-icon)]">CUSTOM</span>
                                            </div>
                                            <textarea
                                                value={identity.customSettings}
                                                onChange={(e) => updateIdentity(identity.id, { customSettings: e.target.value })}
                                                placeholder="更深度的性格爱好描述，对话的特殊要求等..."
                                                rows={4}
                                                className="ui-textarea bg-transparent"
                                            />
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除身份卡片后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeIdentity(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
}
