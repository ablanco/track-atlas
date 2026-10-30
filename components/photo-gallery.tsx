"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "./ui/carousel";
import type { PhotoDraft } from "./photo-picker";
export function PhotoGallery({
  trackId,
  photos,
  canEdit,
}: {
  trackId: string;
  photos: PhotoDraft[];
  canEdit: boolean;
}) {
  const t = useTranslations("Photos");
  const [selected, setSelected] = useState<number | null>(null);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!api) return;
    const update = () => setCurrent(api.selectedScrollSnap());
    api.on("select", update);
    return () => {
      api.off("select", update);
    };
  }, [api]);
  if (!photos.length) return null;
  const src = (id: string, size: string, format: string) =>
    `/api/tracks/${trackId}/photos/${id}?size=${size}&format=${format}`;
  return (
    <section aria-label={t("title")} className="space-y-3">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {photos.slice(0, 5).map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            className="relative min-h-32 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              setCurrent(i);
              setSelected(i);
            }}
            aria-label={`${t("title")} ${i + 1} / ${photos.length}`}
          >
            <img
              className="h-32 w-full object-cover"
              src={src(photo.id, "thumbnail", "webp")}
              alt={photo.caption}
            />
            {i === 4 && photos.length > 5 && (
              <span className="absolute inset-0 grid place-items-center bg-black/50 text-2xl text-white">
                +{photos.length - 5}
              </span>
            )}
          </button>
        ))}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="h-dvh max-h-dvh w-screen max-w-none rounded-none sm:max-w-none"
          closeButtonProps={{ "aria-label": t("close") }}
          onKeyDown={(event) => {
            if (event.defaultPrevented) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              api?.scrollPrev();
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              api?.scrollNext();
            }
          }}
        >
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {photos.length} {t("title")}
          </DialogDescription>
          {selected !== null && (
            <Carousel
              setApi={setApi}
              opts={{ startIndex: selected, loop: false }}
              className="mx-10 min-w-0"
            >
              <CarouselContent>
                {photos.map((photo, i) => (
                  <CarouselItem
                    key={photo.id}
                    inert={i !== current}
                    aria-hidden={i !== current}
                  >
                    {Math.abs(i - current) <= 1 && (
                      <PhotoSlide
                        photo={photo}
                        index={i}
                        total={photos.length}
                        src={src}
                        canEdit={canEdit}
                      />
                    )}
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious aria-label={t("previous")} />
              <CarouselNext aria-label={t("next")} />
            </Carousel>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function PhotoSlide({
  photo,
  index,
  total,
  src,
  canEdit,
}: {
  photo: PhotoDraft;
  index: number;
  total: number;
  src: (id: string, size: string, format: string) => string;
  canEdit: boolean;
}) {
  const t = useTranslations("Photos");
  return (
    <figure className="space-y-3">
      <picture>
        <source type="image/avif" srcSet={src(photo.id, "large", "avif")} />
        <source type="image/webp" srcSet={src(photo.id, "large", "webp")} />
        <img
          loading="lazy"
          src={src(photo.id, "large", "jpeg")}
          alt={photo.caption}
          className="h-[75dvh] w-full object-contain"
        />
      </picture>
      <figcaption className="text-center whitespace-pre-wrap">
        {photo.caption}
        <span className="block">
          {index + 1} / {total}
        </span>
        {canEdit && (
          <a href={`/api/files/${photo.id}`} className="underline">
            {t("original")}
          </a>
        )}
      </figcaption>
    </figure>
  );
}
