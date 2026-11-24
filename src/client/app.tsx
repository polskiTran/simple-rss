import { useAccess } from './authentication.js'
import { GateScreen } from './screens/gate-screens.js'
import { Shell } from './screens/shell.js'
import { useNavigation } from './routing.js'

export function App() {
  const navigation = useNavigation()
  const gate = useAccess()
  return gate.access.kind === 'open' ? (
    <Shell navigation={navigation} onAccessChanged={gate.adopt} />
  ) : (
    <GateScreen gate={gate} />
  )
}
