import { About } from './views/About'
import { Game } from './views/Game'
import { Group } from './views/Group'
import { Home } from './views/Home'
import { PersonForm } from './views/PersonForm'
import { PersonPage } from './views/PersonPage'
import { Plan, SessionView } from './views/Session'
import { useRoute } from './ui'

export function App() {
  const [page, id, sub] = useRoute()
  let view
  if (page === 'new') view = <PersonForm />
  else if (page === 'p' && id && sub === 'edit') view = <PersonForm id={id} />
  else if (page === 'p' && id && sub === 'game') view = <Game id={id} />
  else if (page === 'p' && id) view = <PersonPage id={id} />
  else if (page === 'plan' && id) view = <Plan ids={id.split('+')} />
  else if (page === 's' && id) view = <SessionView id={id} />
  else if (page === 'about') view = <About />
  else if (page === 'group') view = <Group />
  else view = <Home />
  return (
    <div className="shell">
      <header className="top">
        <a className="brand" href="#/">
          <b>Encore</b>
          <span>reminiscence sessions, grounded in taste</span>
        </a>
        <nav>
          <a href="#/" className={!page ? 'on' : ''}>
            People
          </a>
          <a href="#/group" className={page === 'group' ? 'on' : ''}>
            Group session
          </a>
          <a href="#/about" className={page === 'about' ? 'on' : ''}>
            How it works
          </a>
        </nav>
      </header>
      <main>{view}</main>
      <footer className="foot">
        Encore is a planning aid for caregivers, not medical advice. Cultural data from Qloo. Names and notes stay in this
        browser.
      </footer>
    </div>
  )
}
