"use client";
import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { FollowState } from "@/following/types";
import { Button } from "@/components/ui/button";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { UserCheckIcon } from "@phosphor-icons/react/dist/csr/UserCheck";
import { LoginModal, type AuthLabels } from "./auth-control";
import { usePrivateFollowing } from "./use-private-following";

export function FollowControl({
  uploaderId,
  labels,
}: {
  uploaderId: string;
  labels: AuthLabels;
}) {
  const t = useTranslations("Following");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const resource = usePrivateFollowing<FollowState>(
    `/api/users/${uploaderId}/follow`,
  );
  const [login, setLogin] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { data, pending, loading, error } = resource;
  const FollowIcon = data?.following ? UserCheckIcon : UserPlusIcon;
  async function toggle() {
    if (error === "unauthorized") {
      setLogin(true);
      return;
    }
    if (!data) {
      resource.reload();
      return;
    }
    const value = await resource.put(`/api/users/${uploaderId}/follow`, {
      following: !data.following,
    });
    if (value) resource.setData(value as FollowState);
  }
  return (
    <div className="mt-3 space-y-2">
      <Button
        ref={trigger}
        type="button"
        variant="outline"
        disabled={
          pending || loading || (!!data && !data.following && !data.eligible)
        }
        aria-pressed={data?.following ?? false}
        aria-busy={pending || loading}
        aria-describedby={`${id}-notice`}
        title={data?.following ? t("unfollow") : undefined}
        onClick={() => void toggle()}
      >
        <FollowIcon aria-hidden="true" weight="regular" />
        {t(
          pending
            ? "pending"
            : loading
              ? "loading"
              : data?.following
                ? "following"
                : "follow",
        )}
      </Button>
      {error === "unavailable" && (
        <p role="alert" className="text-sm text-destructive">
          {t("changeFailed")}{" "}
          <Button
            variant="outline"
            disabled={pending}
            onClick={resource.reload}
          >
            {t("retry")}
          </Button>
        </p>
      )}
      <p id={`${id}-notice`} className="max-w-lg text-sm text-muted-foreground">
        {t("description")}{" "}
        <Link href="/settings" className="underline underline-offset-4">
          {t("settings")}
        </Link>
      </p>
      <p className="max-w-lg text-sm text-muted-foreground">
        {t("confirmation")}
      </p>
      {login && (
        <LoginModal
          locale={locale}
          labels={labels}
          onSubmit={() => {}}
          onClose={() => {
            setLogin(false);
            trigger.current?.focus({ preventScroll: true });
          }}
          onSuccess={() => {
            setLogin(false);
            resource.reload();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
