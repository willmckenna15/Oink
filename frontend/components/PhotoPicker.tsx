"use client";

/**
 * Photos queued against a write-up, before they're uploaded.
 *
 * The picker is `multiple`, so several can be chosen at once — but choosing
 * again used to *replace* the queue rather than add to it, so anyone who picked
 * one, then went back for another, silently lost the first. Photos of a meal
 * arrive one at a time as often as not, so that read as a one-photo limit.
 *
 * Two smaller things follow from fixing it:
 *
 *   The input's value is cleared after every pick, or choosing the same file
 *   twice in a row fires no change event at all and the second pick vanishes.
 *
 *   Duplicates are dropped on name, size and modified time — the same photo
 *   picked twice is a slip, not an instruction to upload it twice.
 *
 * And once a queue can be added to, it has to be possible to take things out of
 * it, so they're thumbnails with a remove rather than a count.
 */
import { useEffect, useRef, useState } from "react";

const identity = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export default function PhotoPicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  // Object URLs hold the file in memory until they're revoked, so each set is
  // released as soon as the queue changes or the sheet closes.
  useEffect(() => {
    const made = files.map((f) => URL.createObjectURL(f));
    setPreviews(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  function add(picked: FileList | null) {
    if (!picked?.length) return;
    const seen = new Set(files.map(identity));
    onChange([...files, ...Array.from(picked).filter((f) => !seen.has(identity(f)))]);
  }

  return (
    <div className="space-y-2">
      <p className="font-display text-sm font-bold">
        photos
        {files.length > 0 && (
          <span className="ml-1 font-normal text-ink-soft">
            ({files.length} to upload)
          </span>
        )}
      </p>

      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          // Same file twice in a row fires no change unless the value is cleared.
          e.target.value = "";
        }}
      />

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <div key={identity(file)} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local
                  object URL; there is nothing for the Next loader to do. */}
              <img
                src={previews[i]}
                alt={file.name}
                className="h-16 w-16 rounded-lg border-2 border-ink object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(files.filter((f) => identity(f) !== identity(file)))}
                className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold"
                aria-label={`remove ${file.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => input.current?.click()}
        className="btn-plain w-full text-sm"
      >
        {files.length ? "Add more photos" : "Add photos"}
      </button>
    </div>
  );
}
