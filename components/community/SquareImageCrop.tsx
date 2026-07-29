"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const OUTPUT_SIZE = 1280;

type SquareImageCropProps = {
  file: File;
  onCancel: () => void;
  /** Cropped square file — may upload; cropper stays open with a spinner until this settles. */
  onConfirm: (file: File) => void | Promise<void>;
};

type Layout = {
  /** Displayed image box inside the stage. */
  w: number;
  h: number;
  left: number;
  top: number;
  naturalW: number;
  naturalH: number;
};

/**
 * Pick a square from an uploaded image, then hand back that crop to upload.
 *
 * The picture stays fully visible (`object-fit: contain`). A square frame sits
 * on top — drag it, or shrink it with the slider — then we bake only that
 * square for upload.
 */
export function SquareImageCrop({
  file,
  onCancel,
  onConfirm,
}: SquareImageCropProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // Create the blob URL in an effect — not useMemo. Strict Mode remounts run
  // the cleanup (revoke) while keeping a memoized URL, which leaves a dead
  // `blob:` src and the broken-image icon you're seeing.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  /** Crop square size as a fraction of the shorter displayed side (0.35–1). */
  const [scale, setScale] = useState(1);
  /** Top-left of the crop, relative to the displayed image box. */
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const originReady = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    originReady.current = false;
    setLayout(null);
    setOrigin({ x: 0, y: 0 });
    setScale(1);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img?.naturalWidth) return;

    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (sw < 2 || sh < 2) return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fit = Math.min(sw / nw, sh / nh);
    const w = nw * fit;
    const h = nh * fit;
    const next: Layout = {
      w,
      h,
      left: (sw - w) / 2,
      top: (sh - h) / 2,
      naturalW: nw,
      naturalH: nh,
    };
    setLayout(next);

    const sideNow = Math.min(w, h) * scale;
    const maxX = Math.max(0, w - sideNow);
    const maxY = Math.max(0, h - sideNow);
    setOrigin((prev) => {
      if (!originReady.current) {
        originReady.current = true;
        return { x: maxX / 2, y: maxY / 2 };
      }
      return {
        x: Math.min(prev.x, maxX),
        y: Math.min(prev.y, maxY),
      };
    });
  }, [scale]);

  useEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measure, objectUrl]);

  useEffect(() => {
    if (!layout) return;
    const side = Math.min(layout.w, layout.h) * scale;
    setOrigin((prev) => ({
      x: Math.min(prev.x, Math.max(0, layout.w - side)),
      y: Math.min(prev.y, Math.max(0, layout.h - side)),
    }));
  }, [scale, layout]);

  const side = layout ? Math.min(layout.w, layout.h) * scale : 0;

  function onPointerDown(event: React.PointerEvent) {
    if (!layout) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !layout) return;
    const maxX = Math.max(0, layout.w - side);
    const maxY = Math.max(0, layout.h - side);
    setOrigin({
      x: Math.min(
        maxX,
        Math.max(0, drag.originX + (event.clientX - drag.startX))
      ),
      y: Math.min(
        maxY,
        Math.max(0, drag.originY + (event.clientY - drag.startY))
      ),
    });
  }

  function onPointerUp(event: React.PointerEvent) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  async function confirm() {
    if (!layout || side <= 0 || busy) return;
    setBusy(true);
    try {
      const img = imgRef.current;
      if (!img) return;

      const scaleX = layout.naturalW / layout.w;
      const sx = origin.x * scaleX;
      const sy = origin.y * scaleX;
      const sSide = side * scaleX;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sSide, sSide, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const preferPng = file.type === "image/png" || file.type === "image/gif";
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          resolve,
          preferPng ? "image/png" : "image/jpeg",
          preferPng ? undefined : 0.92
        );
      });
      if (!blob) return;

      const base = file.name.replace(/\.[^.]+$/, "") || "lore-art";
      await onConfirm(
        new File([blob], `${base}-square.${preferPng ? "png" : "jpg"}`, {
          type: blob.type,
        })
      );
    } finally {
      setBusy(false);
    }
  }

  const shade = layout
    ? {
        top: {
          left: layout.left,
          top: layout.top,
          width: layout.w,
          height: Math.max(0, origin.y),
        },
        bottom: {
          left: layout.left,
          top: layout.top + origin.y + side,
          width: layout.w,
          height: Math.max(0, layout.h - origin.y - side),
        },
        left: {
          left: layout.left,
          top: layout.top + origin.y,
          width: Math.max(0, origin.x),
          height: side,
        },
        right: {
          left: layout.left + origin.x + side,
          top: layout.top + origin.y,
          width: Math.max(0, layout.w - origin.x - side),
          height: side,
        },
      }
    : null;

  return (
    <div
      className="lore-crop"
      role="dialog"
      aria-modal="true"
      aria-label="Crop image to a square"
    >
      <div className="lore-crop-panel">
        <p className="lore-crop-lead">
          Drag the square to frame what you want. Everything outside is cut off
          before upload.
        </p>
        <div ref={stageRef} className="lore-crop-stage">
          {objectUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={objectUrl}
              ref={imgRef}
              src={objectUrl}
              alt=""
              className="lore-crop-image"
              draggable={false}
              onLoad={measure}
            />
          ) : (
            <p className="lore-crop-loading">Loading preview…</p>
          )}
          {layout && shade && !busy && (
            <>
              <div className="lore-crop-shade" style={shade.top} />
              <div className="lore-crop-shade" style={shade.bottom} />
              <div className="lore-crop-shade" style={shade.left} />
              <div className="lore-crop-shade" style={shade.right} />
              <div
                className="lore-crop-square"
                style={{
                  left: layout.left + origin.x,
                  top: layout.top + origin.y,
                  width: side,
                  height: side,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </>
          )}
          {busy && (
            <div className="lore-crop-busy" aria-live="polite" aria-busy="true">
              <span className="lore-crop-spinner" aria-hidden="true" />
            </div>
          )}
        </div>
        <label className="lore-crop-zoom">
          <span>Square size</span>
          <input
            type="range"
            min={35}
            max={100}
            value={Math.round(scale * 100)}
            onChange={(e) => setScale(Number(e.target.value) / 100)}
            disabled={busy}
          />
        </label>
        <div className="lore-crop-actions">
          <button
            type="button"
            className="btn soft"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void confirm()}
            disabled={busy || !layout}
          >
            Use square
          </button>
        </div>
      </div>
    </div>
  );
}

/** Upload a lore image file; returns the public URL. */
export async function uploadLoreImage(file: File): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch("/api/community/lore/upload", {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error || "Upload failed — try a smaller JPEG or PNG.");
  }
  return data.url;
}
