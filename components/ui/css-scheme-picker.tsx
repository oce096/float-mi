"use client";
import { useState, useEffect, useRef } from "react";
import { getSchemes, saveScheme, deleteScheme, updateScheme, type CSSScheme } from "@/lib/css-scheme-storage";
import { Save, FolderOpen, Trash2, Pencil, Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import { CSSImportButton } from "@/components/ui/css-import-button";

/** Semantic color tokens for the modal — pass CSS var() references so they follow the active theme */
type ModalVars = {
  panel?: string;       // modal background
  border?: string;      // borders & dividers
  text?: string;        // primary text
  textDim?: string;     // secondary / placeholder text
  input?: string;       // input background
  inputBorder?: string; // input border
  accent?: string;      // action button
};

const defaults: Required<ModalVars> = {
  panel: "var(--c-panel, #fff)",
  border: "var(--c-card-border, #eee)",
  text: "var(--c-text-title, #1a1a1a)",
  textDim: "var(--c-icon, #999)",
  input: "var(--c-input, #f7f7f7)",
  inputBorder: "var(--c-input-border, #ddd)",
  accent: "var(--c-icon-active, #07c160)",
};

type Props = {
  target: string;
  onLoad: (css: string) => void;
  currentCSS: string;
  btnStyle?: React.CSSProperties;
  modalVars?: ModalVars;
};

const defaultBtn: React.CSSProperties = {
  height: 36, minWidth: 36, borderRadius: 8,
  border: "1px solid var(--c-input-border, #ddd)",
  background: "var(--c-input, #f7f7f7)",
  color: "var(--c-icon, #999)",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  gap: 4, cursor: "pointer", flexShrink: 0, padding: "0 10px",
  fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 500,
};

export default function CSSSchemeBar({ target, onLoad, currentCSS, btnStyle, modalVars }: Props) {
  const v = { ...defaults, ...modalVars };
  const [schemes, setSchemes] = useState<CSSScheme[]>([]);
  const [modal, setModal] = useState<"save" | "load" | "edit" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [editingSchemeId, setEditingSchemeId] = useState<string | null>(null);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [editCssDraft, setEditCssDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const refreshSchemes = () => setSchemes(getSchemes(target));

  useEffect(() => { refreshSchemes(); }, [target]);
  useEffect(() => { if (modal === "save") setTimeout(() => inputRef.current?.focus(), 50); }, [modal]);
  useEffect(() => {
    setPortalTarget(document.querySelector<HTMLElement>(".phone-shell") || document.body);
  }, []);

  const btn = { ...defaultBtn, ...btnStyle };
  const iconOnlyBtn: React.CSSProperties = { ...btn, padding: 0, width: btnStyle?.width ?? 36, minWidth: btnStyle?.width ?? 36 };

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveScheme(target, saveName.trim(), currentCSS);
    refreshSchemes();
    setSaveName("");
    setModal("load");
  };

  const handleLoad = (s: CSSScheme) => {
    onLoad(s.css);
    setModal(null);
  };

  const openEditScheme = (s: CSSScheme) => {
    setEditingSchemeId(s.id);
    setEditNameDraft(s.name);
    setEditCssDraft(s.css);
    setConfirmingId(null);
    setModal("edit");
  };

  const handleSaveEdit = (andApply = false) => {
    if (!editingSchemeId || !editNameDraft.trim()) return;
    const updated = updateScheme(editingSchemeId, { name: editNameDraft.trim(), css: editCssDraft });
    refreshSchemes();
    if (andApply && updated) {
      onLoad(updated.css);
      setModal(null);
    } else {
      setModal("load");
    }
    setEditingSchemeId(null);
  };

  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    deleteScheme(id);
    setSchemes(prev => prev.filter(x => x.id !== id));
    setConfirmingId(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setModal("save"); setSaveName(""); }}
        disabled={!currentCSS.trim()}
        title="存为美化预设"
        style={{ ...iconOnlyBtn, opacity: currentCSS.trim() ? 1 : 0.4 }}
      >
        <Save size={15} />
      </button>
      <button
        type="button"
        onClick={() => { refreshSchemes(); setConfirmingId(null); setModal("load"); }}
        title="美化预设库（加载/改名/改CSS）"
        style={btnStyle?.width ? iconOnlyBtn : btn}
      >
        <FolderOpen size={15} />
        {!btnStyle?.width && <span>预设</span>}
      </button>
      <CSSImportButton
        onImport={(importedCss) => {
          onLoad(importedCss);
        }}
        buttonStyle={iconOnlyBtn}
      />

      {modal && portalTarget ? createPortal(
        <div
          onClick={() => setModal(null)}
          style={{
            position: "absolute", inset: 0, zIndex: 10050,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: modal === "edit" ? 340 : 316,
              background: v.panel, borderRadius: 16,
              boxShadow: "0 10px 36px rgba(0,0,0,0.22)",
              overflow: "hidden",
              display: "flex", flexDirection: "column",
              maxHeight: "82vh",
            }}
          >
            {/* Header */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "14px 16px 10px",
              borderBottom: `1px solid ${v.border}`,
              flexShrink: 0,
            }}>
              <span style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600, color: v.text }}>
                {modal === "save" ? "保存为美化预设" : modal === "edit" ? "编辑美化预设" : "美化预设库"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {modal === "load" && currentCSS.trim() && (
                  <button
                    type="button"
                    onClick={() => { setSaveName(""); setModal("save"); }}
                    style={{
                      background: v.input, border: `1px solid ${v.border}`, borderRadius: 8,
                      padding: "4px 8px", fontSize: "calc(11px*var(--app-text-scale,1))",
                      color: v.text, cursor: "pointer", fontWeight: 500,
                    }}
                  >
                    + 存当前CSS
                  </button>
                )}
                <button type="button" onClick={() => setModal(null)} style={{ background: "none", border: "none", color: v.textDim, cursor: "pointer", padding: 2 }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
              {modal === "save" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: v.textDim }}>
                    将当前正在使用的 CSS 保存为美化预设，之后可随时一键切换或二次修改。
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      ref={inputRef}
                      value={saveName}
                      onChange={e => setSaveName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSave()}
                      placeholder="输入美化预设名称..."
                      style={{
                        flex: 1, minWidth: 0, height: 38, borderRadius: 10, paddingLeft: 12,
                        border: `1px solid ${v.inputBorder}`,
                        background: v.input, color: v.text,
                        fontSize: "calc(14px*var(--app-text-scale,1))", outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!saveName.trim()}
                      style={{
                        height: 38, padding: "0 16px", borderRadius: 10, border: "none",
                        background: v.accent, color: "#fff",
                        fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: 600, cursor: "pointer",
                        opacity: saveName.trim() ? 1 : 0.4,
                      }}
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : modal === "edit" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: v.textDim }}>预设名称</label>
                    <input
                      value={editNameDraft}
                      onChange={e => setEditNameDraft(e.target.value)}
                      placeholder="预设名称"
                      style={{
                        width: "100%", height: 36, borderRadius: 8, padding: "0 10px",
                        border: `1px solid ${v.inputBorder}`,
                        background: v.input, color: v.text,
                        fontSize: "calc(13px*var(--app-text-scale,1))", outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: v.textDim }}>CSS 代码内容</label>
                      {currentCSS.trim() && (
                        <button
                          type="button"
                          onClick={() => setEditCssDraft(currentCSS)}
                          style={{
                            background: "none", border: "none", padding: 0,
                            fontSize: "calc(11px*var(--app-text-scale,1))", color: v.accent, cursor: "pointer",
                          }}
                        >
                          用当前编辑器内容覆盖
                        </button>
                      )}
                    </div>
                    <textarea
                      value={editCssDraft}
                      onChange={e => setEditCssDraft(e.target.value)}
                      spellCheck={false}
                      rows={9}
                      placeholder="/* 在此编辑预设的 CSS 代码... */"
                      style={{
                        width: "100%", borderRadius: 10, padding: "10px",
                        border: `1px solid ${v.inputBorder}`,
                        background: v.input, color: v.text,
                        fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
                        fontSize: "calc(12px*var(--app-text-scale,1))", lineHeight: 1.55,
                        resize: "vertical", outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                    <button
                      type="button"
                      onClick={() => setModal("load")}
                      style={{
                        flex: 1, height: 36, borderRadius: 8,
                        border: `1px solid ${v.border}`, background: "transparent", color: v.textDim,
                        fontSize: "calc(13px*var(--app-text-scale,1))", cursor: "pointer",
                      }}
                    >
                      返回
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(false)}
                      disabled={!editNameDraft.trim()}
                      style={{
                        flex: 1, height: 36, borderRadius: 8,
                        border: `1px solid ${v.border}`, background: v.input, color: v.text,
                        fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 500, cursor: "pointer",
                        opacity: editNameDraft.trim() ? 1 : 0.4,
                      }}
                    >
                      仅保存
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(true)}
                      disabled={!editNameDraft.trim()}
                      style={{
                        flex: 1.2, height: 36, borderRadius: 8, border: "none",
                        background: v.accent, color: "#fff",
                        fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 600, cursor: "pointer",
                        opacity: editNameDraft.trim() ? 1 : 0.4,
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                      }}
                    >
                      <Check size={14} /> 保存并使用
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                  {schemes.length === 0 ? (
                    <div style={{ textAlign: "center", color: v.textDim, fontSize: "calc(13px*var(--app-text-scale,1))", padding: "22px 8px" }}>
                      暂无保存的美化预设<br />
                      <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", opacity: 0.8 }}>
                        点左侧保存图标或从资源集市拉取 CSS 后会自动收入此处
                      </span>
                    </div>
                  ) : schemes.map(s => (
                    <div key={s.id} style={{ display: "flex", flexDirection: "column", flexShrink: 0, borderRadius: 10, border: `1px solid ${v.border}`, background: v.input, overflow: "hidden" }}>
                      <div
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          minHeight: 46,
                          padding: "6px 8px 6px 12px",
                          cursor: "pointer",
                        }}
                        onClick={() => confirmingId === s.id ? null : handleLoad(s)}
                      >
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: "calc(13.5px*var(--app-text-scale,1))", fontWeight: 500, color: v.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}
                          </span>
                          <span style={{ fontSize: "calc(10.5px*var(--app-text-scale,1))", color: v.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim().slice(0, 40) || "空样式"}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label={`编辑预设 ${s.name}`}
                          title="修改名称或 CSS 内容"
                          onClick={e => { e.stopPropagation(); openEditScheme(s); }}
                          style={{
                            width: 32, height: 32, borderRadius: 8, border: "none",
                            background: "transparent", color: v.textDim,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", flexShrink: 0,
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除预设 ${s.name}`}
                          title="删除预设"
                          onClick={e => { e.stopPropagation(); setConfirmingId(confirmingId === s.id ? null : s.id); }}
                          style={{
                            width: 32, height: 32, borderRadius: 8, border: "none",
                            background: "transparent", color: "var(--c-danger, #fa5151)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", flexShrink: 0,
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {confirmingId === s.id && (
                        <div style={{ display: "flex", flexShrink: 0, borderTop: `1px solid ${v.border}` }}>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setConfirmingId(null); }}
                            style={{ flex: 1, minHeight: 34, padding: "6px 0", background: "transparent", border: "none", color: v.textDim, fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", borderRight: `1px solid ${v.border}` }}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleDelete(s.id); }}
                            style={{ flex: 1, minHeight: 34, padding: "6px 0", background: "transparent", border: "none", color: "var(--c-danger, #fa5151)", fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 500, cursor: "pointer" }}
                          >
                            确定删除
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        portalTarget
      ) : null}
    </>
  );
}
