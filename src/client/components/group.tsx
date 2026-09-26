import type { ReactNode } from 'react'

export interface GroupProps {
  /** Ties the heading to its section; unique on the page. */
  readonly id: string
  readonly title: ReactNode
  /** Shown only when the whole group is loaded — a partial count is a wrong one. */
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
