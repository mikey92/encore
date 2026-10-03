export function About() {
  return (
    <div style={{ maxWidth: 760 }}>
      <span className="tag">How it works</span>
      <h1>Personal, not generic.</h1>
      <p>
        Reminiscence sessions work best when the songs, films and places are the person’s own. Most activity programs play
        the same oldies for everyone. Encore uses Qloo’s taste graph to find what <em>this</em> person most likely loved, in
        the years they remember best, from the culture they grew up in.
      </p>

      <h2>Why it matters</h2>
      <ul>
        <li>
          More than 55 million people live with dementia worldwide, with nearly 10 million new cases a year (
          <a href="https://www.who.int/news-room/fact-sheets/detail/dementia" target="_blank" rel="noreferrer">
            WHO
          </a>
          ).
        </li>
        <li>
          Reminiscence work shows small but real benefits for communication, mood and, in care homes, quality of life (
          <a href="https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD001120.pub3/full" target="_blank" rel="noreferrer">
            Cochrane review, 2018
          </a>
          ).
        </li>
        <li>
          U.S. nursing homes must offer activities that meet each resident’s own interests and preferences (CMS F679, 42 CFR
          §483.24(c)(1)). Encore turns that requirement into twenty prepared minutes.
        </li>
      </ul>

      <h2>The years that matter</h2>
      <p>
        People recall the events and music of roughly ages 10 to 30 more vividly than any other period, an effect
        psychologists call the reminiscence bump. Encore takes the year of birth and searches that window: films and TV
        released then, artists who were recording then, stars a few years older than them.
      </p>

      <h2>What Encore asks Qloo</h2>
      <div className="card" style={{ margin: '12px 0 22px' }}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <b>Search</b> turns a favourite like “Pedro Infante” into a Qloo entity.
          </li>
          <li>
            <b>Insights</b> finds artists, films, TV shows, stars and landmarks that fans of those favourites love, with
            weighted signals, release-year and birth-date windows, the country a film was made in, and excluded themes such
            as war.
          </li>
          <li>
            <b>Location signals</b> add what people in their hometown, or the country their family came from, love.
          </li>
          <li>
            <b>Explainability</b> tells caregivers which favourite each suggestion comes from.
          </li>
          <li>
            <b>This or That</b> asks about music styles of their youth first, then uses those picks as signals to choose
            the films it asks about next.
          </li>
        </ul>
      </div>

      <h2>Research, checked by Qloo</h2>
      <p>
        Qloo’s taste signals know less about older films, TV and stars from outside the U.S. So while Qloo works, a research
        assistant lists what people of the person’s background loved back then. Qloo decides: each suggestion has to be a
        Qloo entity from the person’s youth, and Qloo scores it against their favourites. Anything Qloo can’t ground is
        dropped, so nothing invented reaches the session.
      </p>

      <h2>A careful curator</h2>
      <p>
        A language model then reviews Qloo’s candidates for each moment, all moments side by side, and each one updates on
        screen as soon as it is done. It can only choose among the candidates, and it leaves out anything likely to upset
        someone living with dementia: stories about violence or loss, political figures, places tied to tragedy,
        attractions that didn’t exist when they were young. It writes open prompts that invite stories instead of testing
        memory, in the person’s own language when that isn’t English.
      </p>

      <h2>It learns</h2>
      <p>
        After each moment, tap how it landed. What lit them up becomes a stronger signal next time; anything that unsettled
        them is left out for good.
      </p>

      <h2>Privacy</h2>
      <p>
        Names, notes and session history stay in this browser. To plan, Encore sends a birth year, a hometown, family roots,
        favourites and themes to avoid. Notes go to the writing assistant, so leave out names.
      </p>

      <p className="muted small">
        Encore is a planning aid for caregivers and activity staff. It is not a medical device and does not give medical
        advice.
      </p>
    </div>
  )
}
