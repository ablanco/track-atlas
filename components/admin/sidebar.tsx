"use client";

import { useTranslations } from "next-intl";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { adminModels } from "@/admin/models";
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
  useSidebar,
} from "@/components/ui/sidebar";

export function AdminSidebar() {
  const t = useTranslations("Admin");
  const pathname = usePathname();
  const model = pathname.split("/")[2];
  const { setOpenMobile } = useSidebar();
  const links = [
    { href: "/admin", label: t("overview"), active: !model },
    ...Object.keys(adminModels).map((name) => ({
      href: "/admin/" + name,
      label: t(`models.${name}`),
      active: model === name,
    })),
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
                {links.map(({ href, label, active }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={active}
                      aria-current={active ? "page" : undefined}
                      className="h-auto min-h-11 [&>span:last-child]:whitespace-normal"
                      render={<Link href={href} prefetch={false} />}
                      onClick={() => setOpenMobile(false)}
                    >
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
