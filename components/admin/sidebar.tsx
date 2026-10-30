"use client";

import { useTranslations } from "next-intl";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import type { AdminModel } from "@/admin/models";
import { Link, usePathname } from "@/i18n/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function AdminSidebar() {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  const model = pathname.split("/")[2];
  const { setOpenMobile } = useSidebar();
  const groups: {
    model: AdminModel;
    children: { model: AdminModel; label: string }[];
  }[] = [
    {
      model: "users",
      children: [
        { model: "users", label: t("sidebar.models") },
        { model: "sessions", label: t("models.sessions") },
        {
          model: "account_action_tokens",
          label: t("models.account_action_tokens"),
        },
      ],
    },
    {
      model: "tracks",
      children: [
        { model: "tracks", label: t("sidebar.models") },
        { model: "track_data", label: t("sidebar.data") },
        { model: "track_tags", label: t("sidebar.tags") },
        { model: "track_photos", label: t("models.track_photos") },
        {
          model: "track_photo_versions",
          label: t("models.track_photo_versions"),
        },
        {
          model: "track_directional_representations",
          label: t("models.track_directional_representations"),
        },
      ],
    },
    {
      model: "track_lists",
      children: [
        { model: "track_lists", label: t("sidebar.models") },
        { model: "track_list_memberships", label: t("sidebar.memberships") },
      ],
    },
  ];

  return (
    <Sidebar
      collapsible="offcanvas"
      className="absolute h-full group-data-[collapsible=offcanvas]:invisible"
    >
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2 font-semibold">
          <SquaresFourIcon aria-hidden="true" size={22} />
          {t("title")}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label={t("navigation")}>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={!model}
                    aria-current={!model ? "page" : undefined}
                    className="h-auto min-h-11"
                    render={<Link href="/admin" prefetch={false} />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <span>{t("overview")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {groups.map((group) => (
                  <SidebarMenuItem key={group.model}>
                    <div className="px-2 py-2 text-sm font-medium">
                      {t(`models.${group.model}`)}
                    </div>
                    <SidebarMenuSub aria-label={t(`models.${group.model}`)}>
                      {group.children.map((child) => (
                        <SidebarMenuSubItem key={child.model}>
                          <SidebarMenuSubButton
                            isActive={model === child.model}
                            aria-current={
                              model === child.model ? "page" : undefined
                            }
                            className="h-auto min-h-11 [&>span:last-child]:whitespace-normal"
                            render={
                              <Link
                                href={"/admin/" + child.model}
                                prefetch={false}
                              />
                            }
                            onClick={() => setOpenMobile(false)}
                          >
                            <span>{child.label}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={model === "stored_files"}
                    aria-current={model === "stored_files" ? "page" : undefined}
                    className="h-auto min-h-11 [&>span:last-child]:whitespace-normal"
                    render={
                      <Link href="/admin/stored_files" prefetch={false} />
                    }
                    onClick={() => setOpenMobile(false)}
                  >
                    <span>{t("models.stored_files")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
