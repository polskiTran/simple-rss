import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from './icon.js'

interface ActionDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string | undefined
  readonly trigger: ReactElement
  readonly children: ReactNode
  onOpenChange(open: boolean): void
}

export function ActionDialog({ open, title, description, trigger, children, onOpenChange }: ActionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger render={trigger} />
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="dialog">
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              <Dialog.Close className="button button-ghost button-icon" aria-label="Close">
                <Icon name="x" />
              </Dialog.Close>
            </div>
            {description ? <Dialog.Description className="dialog-description">{description}</Dialog.Description> : null}
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function DialogCancel({ disabled = false }: { readonly disabled?: boolean }) {
  return (
    <Dialog.Close className="button" disabled={disabled} render={<Button focusableWhenDisabled />}>
      Cancel
    </Dialog.Close>
  )
}
