import { ChatScreen } from './screens/ChatScreen'
import { HostSetupScreen } from './screens/HostSetupScreen'
import { JoinSetupScreen } from './screens/JoinSetupScreen'
import { LaunchScreen } from './screens/LaunchScreen'
import { useStore } from './state/store'

function App() {
  const { state } = useStore()

  switch (state.phase) {
    case 'hostSetup':
      return <HostSetupScreen />
    case 'joinSetup':
      return <JoinSetupScreen />
    case 'chat':
      return <ChatScreen />
    case 'launch':
    default:
      return <LaunchScreen />
  }
}

export default App
