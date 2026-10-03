# Does Qloo make a difference?

Encore against the same model (gpt-5.5) planning the same session on its own, for 24 people born 1932–1955 in the U.S. and abroad ([personas.json](personas.json)). Everyone gets the same facts: year of birth, hometown, family roots, home language, one or two favourites, and "avoid war". Both plan the same six moments: an opening song, a film, a star, a TV show, a hometown landmark and a closing song. Every pick is then looked up in Qloo ([run.py](run.py)).

- **Encore** is the deployed app: Qloo insights, plus titles a research step suggests that Qloo can ground (the entity exists, it dates from their youth, and Qloo scores its affinity to their favourites), then the curator.
- **Encore, Qloo only** leaves out the research step (an ablation).
- **Model without Qloo** is the same model given the same facts and asked for the same six moments.

| | Encore | Encore, Qloo only | Model without Qloo |
| --- | --- | --- | --- |
| Picks that resolve to a Qloo entity | 100% | 100% | 86% |
| Songs, films and TV from their teens and twenties | 99% of 96 | 99% of 93 | 94% of 85 |
| Roots abroad: films and TV made in that country | 70% of 30 | 68% of 28 | 70% of 20 |
| Roots abroad: films, TV and artists from that country | 64% of 50 | 57% of 47 | 54% of 39 |
| Distinct picks across all 24 people | 141 | 127 | 134 |
| Picks shared by three or more people | 0% | 2% | 2% |

**Most repeated picks**

- Encore: man from u n c l e (2), jeux sans frontieres (2)
- Encore, Qloo only: ray charles (3), i love lucy (2), chespirito (2), zorro (2), elvis presley (2), julie andrews (2)
- Model without Qloo: singin in the rain (3), doris day (2), i love lucy (2), frank sinatra (2), mary poppins (2), julie andrews (2)

## How to read this

- *Resolves to a Qloo entity*: every Encore pick is a Qloo entity by construction, so it comes with a picture, a link, its years and the favourite it connects to. A model-only pick that does not resolve may be real but obscure, or misremembered; either way it cannot be shown, dated or explained.
- *Era* uses Qloo’s release year for films and TV and the first year of recording for artists; picks that could not be checked are left out of the share, so the denominators differ.
- *From that country* uses the country of release for films and TV and the birthplace for artists. It is a rough test: Tito Puente was born in New York.
- Stars and landmarks are not scored for era or culture. Twenty-four people is a small sample; read the side-by-side table as much as the numbers.

## Side by side

| Person | | Song | Film | Star | TV | Landmark | Closing song |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1932, Chicago | Encore | Nat King Cole | Singin' in the Rain | Benny Goodman | Kukla, Fran and Ollie | The Chicago Theatre | Ray Charles |
| | Qloo only | Nat King Cole | Singin' in the Rain | Sarah Vaughan | I Love Lucy | The Chicago Theatre | Ray Charles |
| | Model only | Nat King Cole | Singin' in the Rain | Doris Day | I Love Lucy | Navy Pier | Frank Sinatra |
| 1936, Brooklyn (Italy) | Encore | Frank Sinatra | Come September | Perry Como | The Perry Como Show | Coney Island | The Rat Pack |
| | Qloo only | Frank Sinatra | The Gold of Naples | Ray Charles | The Honeymooners | Statue of Liberty | The Rat Pack |
| | Model only | Frank Sinatra | Roman Holiday | Sophia Loren | The Honeymooners | Coney Island Boardwalk ✗ | Dean Martin |
| 1938, San Antonio (Mexico) | Encore | Pedro Infante | School for Tramps | Cantinflas | Los Beverly de Peralvillo | San Fernando Cathedral | Lola Beltrán |
| | Qloo only | Pedro Infante | School for Tramps | Chespirito | Zorro | San Fernando Cathedral | La Sonora Santanera |
| | Model only | Pedro Infante | A.T.M. ¡A toda máquina! | María Félix | El Club del Hogar ✗ | San Antonio River Walk | Ritchie Valens |
| 1941, Memphis | Encore | Elvis Presley | The Music Man | Julie Andrews | Shindig! | Sun Studio | Rufus Thomas |
| | Qloo only | Elvis Presley | Mary Poppins | Julie Andrews | Bewitched | Sun Studio | Aretha Franklin |
| | Model only | Elvis Presley | Mary Poppins | Julie Andrews | The Andy Griffith Show | Beale Street ✗ | Julie Andrews |
| 1943, Detroit | Encore | The Supremes | Funny Girl | Diana Ross | Soul Train | Motown Museum | The Temptations |
| | Qloo only | The Supremes | Funny Girl | Bill Withers | The Carol Burnett Show | Motown Museum | Smokey Robinson and The Miracles |
| | Model only | The Supremes | Bye Bye Birdie | Diana Ross | American Bandstand ⌛ | Belle Isle Park | Marvin Gaye |
| 1945, San Juan (Puerto Rico) | Encore | El Gran Combo de Puerto Rico | Romance en Puerto Rico | José Miguel Agrelot | The Man from U.N.C.L.E. | Parque de las Palomas | Cheo Feliciano |
| | Qloo only | Tito Puente | La criada malcriada | Johnny Ventura | Daktari | La Plaza del Mercado de Santurce | Roberto Roena |
| | Model only | Tito Puente | El Padrecito ✗ | Iris Chacón | El Show de Iris Chacón ✗ | Plaza de Armas, Viejo San Juan ✗ | Celia Cruz |
| 1937, Dublin (Ireland) | Encore | The Clancy Brothers | Darby O'Gill and the Little People | Maureen Potter | The Late Late Show | Phoenix Park | Liam Clancy |
| | Qloo only | The Clancy Brothers | The Rising of the Moon | Elvis Presley | The Late Late Show | Dublin Castle | Liam Clancy |
| | Model only | The Clancy Brothers and Tommy Makem | The Quiet Man | Maureen O'Hara | The Late Late Show | Ha'penny Bridge | Ruby Murray |
| 1935, Chicago (Poland) | Encore | Frankie Yankovic | White Christmas | Marion Lush | Garfield Goose and Friends | Copernicus Center | Ray Price |
| | Qloo only | Frankie Yankovic | How to Marry a Millionaire | Tony Bennett | I Love Lucy | Union Park | Julie Andrews |
| | Model only | Frankie Yankovic | Singin' in the Rain | Doris Day | I Love Lucy | Buckingham Fountain ✗ | The Andrews Sisters |
| 1939, Havana (Cuba) | Encore | Celia Cruz | The Twelve Chairs | Rosita Fornés | Zorro | La Bodeguita Del Medio | Benny Moré |
| | Qloo only | Celia Cruz | – | Chespirito | Zorro | La Bodeguita Del Medio | Johnny Pacheco |
| | Model only | Celia Cruz y La Sonora Matancera | Escuela de vagabundos ✗ | Rosita Fornés | Casino de la Alegría ✗ | El Malecón de La Habana | Benny Moré ✗ |
| 1942, Mumbai (India) | Encore | Lata Mangeshkar | Shree 420 | Raj Kapoor | The Man from U.N.C.L.E. | Marine Drive | Asha Bhosle |
| | Qloo only | Lata Mangeshkar | Guide | Asha Bhosle | – | Gateway Of India Mumbai | Mukesh |
| | Model only | Lata Mangeshkar | Chalti Ka Naam Gaadi | Madhubala | Phool Khile Hain Gulshan Gulshan ✗ | Marine Drive | Kishore Kumar |
| 1944, Kingston (Jamaica) | Encore | Desmond Dekker | The Harder They Come | Peter Tosh | Spider-Man | Coronation Market Jamaica | Ken Boothe |
| | Qloo only | Desmond Dekker | The Harder They Come | Peter Tosh | Julia | – | John Holt |
| | Model only | Desmond Dekker & The Aces | Smile Orange ⌛ | Louise Bennett-Coverley | Ring Ding ✗ | Devon House, Kingston ✗ | Toots and the Maytals |
| 1938, Munich (Germany) | Encore | Freddy Quinn | Freddy, die Gitarre und das Meer | Heinz Erhardt | Musik aus Studio B | Gärtnerplatz | Peter Kraus |
| | Qloo only | Freddy Quinn | Sissi - Die junge Kaiserin | Leonard Nimoy | Sportschau | Gärtnerplatz | Udo Jürgens |
| | Model only | Freddy Quinn | Sissi | Romy Schneider | Der goldene Schuß | Marienplatz, Munich ✗ | Caterina Valente |
| 1950, Nashville | Encore | Johnny Cash | Coal Miner's Daughter | Chet Atkins | Hee Haw | Ryman Auditorium | Dolly Parton |
| | Qloo only | Johnny Cash | Easy Rider | Dolly Parton | The Brady Bunch | Ryman Auditorium | John Denver |
| | Model only | Johnny Cash | Coal Miner's Daughter | Dolly Parton | Hee Haw | Ryman Auditorium | Patsy Cline |
| 1952, Los Angeles | Encore | The Beach Boys | American Graffiti | Carol Burnett | Happy Days | Hollywood Bowl | The Mamas & the Papas |
| | Qloo only | The Beach Boys | American Graffiti | David Bowie | Happy Days | Hollywood Sign | The Mamas & the Papas |
| | Model only | The Beach Boys | American Graffiti | Annette Funicello | Happy Days | Santa Monica Pier ✗ | The Mamas & the Papas |
| 1934, New Orleans | Encore | Louis Armstrong ⌛ | New Orleans | Pete Fountain | American Bandstand | Jackson Square | Irma Thomas |
| | Qloo only | Louis Armstrong ⌛ | Guys and Dolls | Chuck Berry | The Danny Thomas Show | Jackson Square | Ray Charles |
| | Model only | Louis Armstrong ⌛ | High Society | Fats Domino | The Ed Sullivan Show | Jackson Square | Fats Domino |
| 1947, Boston | Encore | The Beatles | A Hard Day's Night | John Lennon | The French Chef | Fenway Park | The Zombies |
| | Qloo only | The Beatles | A Hard Day's Night | Paul McCartney | The Mary Tyler Moore Show | Museum of Fine Arts, Boston | The Beach Boys |
| | Model only | The Beatles | The Graduate | Dustin Hoffman | The Mary Tyler Moore Show | Fenway Park | Simon & Garfunkel |
| 1940, Athens (Greece) | Encore | Nana Mouskouri | Never on Sunday | Aliki Vougiouklaki | Jeux sans frontières | Odeon of Herodes Atticus | Marinella |
| | Qloo only | Nana Mouskouri | Maiden's Cheek | – | To theatro tis Defteras | – | Dalida |
| | Model only | Nana Mouskouri | Never on Sunday | Aliki Vougiouklaki | To Theatro tis Defteras | The Acropolis of Athens | Melina Mercouri |
| 1936, Lisbon (Portugal) | Encore | Amália Rodrigues | O Leão da Estrela | Raul Solnado | Jeux sans frontières | Praça do Comércio | Celeste Rodrigues |
| | Qloo only | Amália Rodrigues | O Leão da Estrela | Elza Soares | Telejornal | Praça do Comércio | Argentina Santos |
| | Model only | Amália Rodrigues | O Leão da Estrela | Amália Rodrigues | Festival RTP da Canção ✗ | Torre de Belém ✗ | Tony de Matos ⌛ |
| 1955, Atlanta | Encore | The Jackson 5 | A Star Is Born | Stevie Wonder | Good Times | Fox Theatre | Commodores |
| | Qloo only | The Jackson 5 | Grease | Stevie Wonder | Good Times | Fox Theatre | Earth, Wind & Fire |
| | Model only | The Jackson 5 | The Wiz | Michael Jackson | Soul Train | Fox Theatre | Earth, Wind & Fire |
| 1946, Toronto (Canada) | Encore | Gordon Lightfoot | The Luck of Ginger Coffey | Johnny Bower | The Friendly Giant | Honest Ed's | Ian & Sylvia |
| | Qloo only | Gordon Lightfoot | Goin' Down the Road | Neil Diamond | The Beachcombers | Canadian National Exhibition | Harry Chapin |
| | Model only | Gordon Lightfoot | Mary Poppins | Anne Murray | The Friendly Giant | CN Tower | Anne Murray |
| 1940, Rome (Italy) | Encore | Domenico Modugno | An American in Rome | Alberto Sordi | Carosello | Piazza Navona | Jimmy Fontana |
| | Qloo only | Domenico Modugno | Big Deal on Madonna Street | Ennio Morricone | Le avventure di Pinocchio | Galleria Borghese | Ornella Vanoni |
| | Model only | Domenico Modugno | La Dolce Vita | Marcello Mastroianni | Carosello | Fontana di Trevi | Adriano Celentano |
| 1948, Paris (France) | Encore | Édith Piaf | The Young Girls of Rochefort | Mireille Mathieu | Les shadoks | Le Trianon | Charles Aznavour |
| | Qloo only | Édith Piaf | Masculine Feminine | Michel Polnareff | Bewitched | La Ménagerie, le zoo du Jardin des Plantes | Christophe |
| | Model only | Édith Piaf | Les Demoiselles de Rochefort ✗ | Catherine Deneuve | Le Manège enchanté ✗ | Tour Eiffel ✗ | Charles Aznavour |
| 1933, Kansas City | Encore | Count Basie | State Fair | Miles Davis | Wagon Train | Union Station Kansas City | Big Joe Turner |
| | Qloo only | Count Basie | Shane | Tony Bennett | The Lone Ranger | Union Station Kansas City | Sonny Rollins |
| | Model only | Count Basie | Singin' in the Rain | James Arness | Gunsmoke | Union Station Kansas City | Duke Ellington ⌛ |
| 1944, Tokyo (Japan) | Encore | Kyu Sakamoto | Late Autumn | – | Astro Boy | Tokyo Tower | 伊東ゆかり |
| | Qloo only | Kyu Sakamoto | Equinox Flower | – | Astro Boy | The National Museum of Modern Art, Tokyo | – |
| | Model only | Kyu Sakamoto | Izu no Odoriko | Hibari Misora | Okaasan to Issho | Tokyo Tower | The Peanuts |

✗ not found in Qloo · ⌛ outside the years they were 10 to 30 · – no pick (the curator may leave a moment out)
