import type { ReactNode } from 'react'

interface GroupProps {
  /** Ties the heading to its section; unique on the page. */
  readonly id: string
  readonly title: ReactNode
  /** The whole group's, or none — a partial count is a wrong one. */
  readonly count?: number | undefined
  readonly aside?: ReactNode
  readonly className?: string
  readonly children: ReactNode
}

export function Group({ id, title, count, aside, className, children }: GroupProps) {
  return (
    <section className={className ? `group ${className}` : 'group'} aria-labelledby={id}>
      <div className="group-header">
        <h2 className="group-heading" id={id}>
          {title}
          {/* A real space, so the heading is announced "Today 14", not "Today14". */}
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

/**
 * Takes the reader into the Group whose heading is `id`: focus lands on the
 * section without a jump, then the page scrolls it to the top — smoothly, unless
 * the User asks for less motion (styles.css).
 */
export function enterSection(id: string) {
  const section = document.getElementById(id)?.closest('section')
  if (!section) return
  section.tabIndex = -1
  section.focus({ preventScroll: true })
  section.scrollIntoView({ block: 'start' })
}
