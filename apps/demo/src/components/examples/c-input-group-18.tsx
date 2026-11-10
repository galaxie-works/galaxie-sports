"use client"

import { useState } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { PlusIcon, MicIcon, GlobeIcon, ChevronDownIcon, ArrowUpIcon } from "lucide-react"

export function Pattern() {
  const [model, setModel] = useState("GPT-4o")

  return (
    <Field className="max-w-xs">
      <InputGroup>
        <InputGroupTextarea
          placeholder="Ask AI anything..."
          className="min-h-24 pb-12"
        />
        <InputGroupAddon align="block-end">
          <div className="flex items-center gap-1">
            <InputGroupButton variant="ghost" size="icon-xs">
              <PlusIcon className="size-4" />
            </InputGroupButton>
            <InputGroupButton variant="ghost" size="icon-xs">
              <MicIcon className="size-4" />
            </InputGroupButton>
            <InputGroupButton variant="ghost" className="h-7 px-2 text-xs">
              <GlobeIcon className="mr-1 size-3.5" />
              Search
            </InputGroupButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                  />
                }
              >
                <Kbd className="border-border rounded-sm border">Σ</Kbd>
                {model}
                <ChevronDownIcon className="ml-1 size-3.5 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-32">
                <DropdownMenuItem onClick={() => setModel("GPT-4o")}>
                  GPT-4o
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModel("GPT-4")}>
                  GPT-4
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModel("Claude 3.5")}>
                  Claude 3.5
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <InputGroupButton
            variant="default"
            size="icon-xs"
            className="ml-auto"
          >
            <ArrowUpIcon className="size-4" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  )
}