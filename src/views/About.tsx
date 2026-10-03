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

      <h2>A careful curator</h2>
      <p>
        A language model then reviews Qloo’s candidates for each moment. It can only choose among them, and it leaves out
        anything likely to upset someone living with dementia: stories about violence or loss, political figures,
        places tied to tragedy, attractions that didn’t exist when they were young. It writes open prompts that invite
        stories instead of testing memory, in the person’s own language when that isn’t English.
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
