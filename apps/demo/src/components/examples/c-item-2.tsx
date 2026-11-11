import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { BellIcon, MailIcon } from "lucide-react"

export default function Pattern() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-2">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <MailIcon
          />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Email Notifications</ItemTitle>
          <ItemDescription>Receive updates via email</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="sm">
            Configure
          </Button>
        </ItemActions>
      </Item>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <BellIcon
          />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Push Notifications</ItemTitle>
          <ItemDescription>Get notified on your device</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button size="sm">Enable</Button>
        </ItemActions>
      </Item>
    </div>
  )
}
