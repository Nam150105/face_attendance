"use client";

import { useEffect } from "react";

/**
 * A photo, as big as the screen allows. Every face thumbnail in the records
 * opens here: on a phone a 96 px crop is not something you can judge a face
 * from, and judging the face is the whole point of keeping it.
 */
export function Lightbox({ src, alt, caption, onClose }: { src: string; alt: string; caption?: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <button type="button" className="lightbox__close" aria-label="Đóng" onClick={onClose}>
        ✕
      </button>
      <img src={src} alt={alt} className="lightbox__image" onClick={(event) => event.stopPropagation()} />
      {caption ? <p className="lightbox__caption">{caption}</p> : null}
    </div>
  );
}

/** A thumbnail that opens the lightbox; the frame stays the same size either way. */
export function ZoomableImage({
  src,
  alt,
  caption,
  className,
  onOpen,
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
  onOpen: (photo: { src: string; alt: string; caption?: string }) => void;
}) {
  return (
    <button type="button" className={`zoomable${className ? ` ${className}` : ""}`} onClick={() => onOpen({ src, alt, caption })} aria-label={`Phóng to: ${alt}`}>
      <img src={src} alt={alt} />
      <span className="zoomable__hint" aria-hidden="true">⤢</span>
    </button>
  );
}
