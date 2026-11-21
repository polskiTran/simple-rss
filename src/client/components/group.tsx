import type { ReactNode } from 'react'

interface GroupProps {
  readonly id: string
  readonly title: ReactNode
  readonly count?: number | undefined
  readonly aside?: ReactNode
  readonly className?: string
  readonly headingClassName?: string
  readonly children: ReactNode
}

export function Group({
  id,
  title,
  count,
  aside,
  className,
  headingClassName = 'group-heading',
  children,
}: GroupProps) {
  return (
    <section className={className ? `group ${className}` : 'group'} aria-labelledby={id}>
      <div className="group-header">
        <h2 className={headingClassName} id={id}>
          {title}
          {count === undefined ? null : (
            <>
              {' '}
              <span className="group-count">{count.toLocaleString('en-GB')}</span>
            </>
          )}
        </h2>
        {aside ? <div className="group-aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function enterSection(id: string) {
  const section = document.getElementById(id)?.closest('section')
  if (!section) return
  section.tabIndex = -1
  section.focus({ preventScroll: true })
  section.scrollIntoView({ block: 'start' })
}
