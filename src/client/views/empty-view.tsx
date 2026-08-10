/**
 * The shell's resting state, before there is anything to read.
 *
 * One quiet line and nothing else: no illustration, no counter, no button
 * urging the User to fill the reader up.
 */
export function EmptyView({ note }: { readonly note: string }) {
  return (
    <div className="view measure">
      <p className="empty-note">{note}</p>
    </div>
  )
}
