"use client"

import { ReactElement, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Item, ItemMedia, ItemTitle } from "@/components/ui/item"
import { LayoutDashboardIcon, ChartBarIcon, FileTextIcon, MessageSquareIcon, UserIcon, ShieldIcon, CreditCardIcon, SettingsIcon, BellIcon, ChevronRightIcon } from "lucide-react"

type NavItem = {
  id: string
  name: string
  icon: ReactElement
  items?: NavItem[]
}

const navItems: NavItem[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    icon: (
      <LayoutDashboardIcon
      />
    ),
    items: [
      {
        id: "analytics",
        name: "Analytics",
        icon: (
          <ChartBarIcon
          />
        ),
        items: [
          {
            id: "real-time",
            name: "Real-time",
            icon: (
              <FileTextIcon aria-hidden="true" />
            ),
          },
          {
            id: "historical",
            name: "Historical",
            icon: (
              <FileTextIcon aria-hidden="true" />
            ),
          },
        ],
      },
      {
        id: "reports",
        name: "Reports",
        icon: (
          <MessageSquareIcon aria-hidden="true" />
        ),
      },
    ],
  },
  {
    id: "team",
    name: "Team",
    icon: (
      <UserIcon aria-hidden="true" />
    ),
    items: [
      {
        id: "members",
        name: "Members",
        icon: (
          <UserIcon aria-hidden="true" />
        ),
      },
      {
        id: "permissions",
        name: "Permissions",
        icon: (
          <ShieldIcon aria-hidden="true" />
        ),
      },
    ],
  },
  {
    id: "billing",
    name: "Billing",
    icon: (
      <CreditCardIcon aria-hidden="true" />
    ),
  },
  {
    id: "settings",
    name: "Settings",
    icon: (
      <SettingsIcon aria-hidden="true" />
    ),
  },
  {
    id: "notifications",
    name: "Notifications",
    icon: (
      <BellIcon aria-hidden="true" />
    ),
  },
]

function NavMenuItem({
  item,
  level = 0,
  selectedId,
  onSelect,
}: {
  item: NavItem
  level?: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const isFolder = !!item.items && item.items.length > 0
  const isSelected = selectedId === item.id

  if (isFolder) {
    return (
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Item
              render={<button type="button" />}
              size="xs"
              className="hover:bg-accent aria-expanded:bg-accent group/item cursor-pointer py-1.25 focus-visible:ring-inset"
              style={{ paddingLeft: `${level * 12 + 8}px` }}
            />
          }
        >
          <ItemMedia variant="icon">
            <div className="text-muted-foreground group-hover/item:text-foreground size-3.5">
              {item.icon}
            </div>
          </ItemMedia>
          <ItemTitle className="text-sm in-aria-expanded:font-semibold">
            {item.name}
          </ItemTitle>
          <ChevronRightIcon aria-hidden="true" className="text-muted-foreground ml-auto size-4 transition-transform in-aria-expanded:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
          <div className="flex flex-col gap-0.5 pt-0.5">
            {item.items?.map((child) => (
              <NavMenuItem
                key={child.id}
                item={child}
                level={level + 1}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <Item
      size="xs"
      className="hover:bg-accent data-[active=true]:bg-accent data-[active=true]:text-foreground group/item cursor-pointer py-1.25"
      data-active={isSelected}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={() => onSelect(item.id)}
    >
      <ItemMedia variant="icon">
        <div className="text-muted-foreground group-hover/item:text-foreground group-data-[active=true]/item:text-foreground size-3.5">
          {item.icon}
        </div>
      </ItemMedia>
      <ItemTitle className="text-sm">{item.name}</ItemTitle>
    </Item>
  )
}

export function Pattern() {
  const [selectedId, setSelectedId] = useState<string | null>("real-time")

  return (
    <div className="min-h-64 w-full max-w-56">
      <Card className="p-0">
        <CardContent className="p-1">
          <div className="flex flex-col gap-0.5">
            {navItems.map((item) => (
              <NavMenuItem
                key={item.id}
                item={item}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}