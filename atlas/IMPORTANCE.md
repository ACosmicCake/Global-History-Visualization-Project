# What "importance" means

**Importance measures how much a subject changed the course of life on Earth or of human societies, judged by its consequences.**

It does not measure fame, drama, age, how well it is documented, or moral worth. A low score never says that the people involved mattered less.

Every record gets four ratings from 0 to 4. They add up to a total from 0 to 16, and the total sets the 1–5 score.

## The four ratings

### R: Reach. Who or what was directly affected, measured against the world of the time?
| | |
|---|---|
| 0 | One site, family or small community |
| 1 | One city or district |
| 2 | One country, people or large province |
| 3 | A major world region, or several countries across regions |
| 4 | Several continents, or most of humanity or of life on Earth |

### D: Depth. How much did daily life, power or the environment change for those affected?
| | |
|---|---|
| 0 | Symbolic or scholarly interest only |
| 1 | A real but minor or short-lived change |
| 2 | Changed an institution, a field of work or art, or many lives |
| 3 | Reordered a society, economy, belief system, culture or state; or killed or displaced a large share of a population |
| 4 | Remade how people live, or caused death on a catastrophic scale for the world or a whole civilization; for natural events, a mass extinction or change of climate state |

### T: Time. How long did the consequences last?
| | |
|---|---|
| 0 | Under 10 years |
| 1 | Decades |
| 2 | A century or more |
| 3 | Several centuries |
| 4 | Millennia, or still shaping the world in a major way after at least several centuries |

### L: Leverage. How much of later history depends on it, and would it have happened anyway?
| | |
|---|---|
| 0 | Nothing later would be different |
| 1 | Local consequences only |
| 2 | Redirected one country or one field |
| 3 | A prerequisite or turning point for many later developments |
| 4 | Later world history cannot be told without it |

## From total to score

| Score | Total | Meaning | Examples |
|---|---|---|---|
| 5 | 13–16, with R ≥ 3 and L ≥ 3 | World-historical: visible from space | Second World War, Black Death, Chicxulub impact, printing press |
| 4 | 10–12, or 13+ without R ≥ 3 and L ≥ 3 | Shaped a world region or a whole field | A dynasty or major war that reordered a region |
| 3 | 7–9 | A major subject in one country or field | A national turning point, a leading scientist's main result |
| 2 | 4–6 | Significant locally or within a specialism | A notable building, a regional battle |
| 1 | 0–3 | Of local or specialist interest | A single site or minor episode |

## Rules for applying the ratings

1. **Consequences, not fame.** Ask what changed, not how often it is mentioned. Wikipedia coverage is only a later check for disagreements, never an input.
2. **The world of the time.** Judge reach against the population and known world when it happened. A change across all of ancient Mesopotamia can reach R 3.
3. **All regions on equal terms.** Reordering a society scores the same anywhere. Thin surviving records are not evidence of small consequences.
4. **The whole outranks its parts.** A part (a battle, treaty, document or stage) is rated for what it added beyond the whole. It reaches 5 only if it is itself a turning point, and its total should not exceed the whole's.
5. **Places.** Rate what the place itself did or made possible: a capital's power, a monument's lasting influence. Events there have their own records and are not counted again. Beauty and fame add nothing by themselves.
6. **People.** Rate what would differ without this person, not the size of the events around them. Lower L by 1 if someone else would soon have done the same.
7. **Works and discoveries.** Rate the change they caused. Lower L by 1 when an independent discovery came at about the same time or the idea had no influence for a long time.
8. **Firsts.** Being the first of something earns nothing by itself. Only what followed from it counts.
9. **Mass death.** Rate deaths in D by share of the affected population. An atrocity's D does not fall because its political aftermath was small.
10. **Natural events.** For subjects before humans, or natural events, those affected are life on Earth, and consequences are measured in the same way.
11. **Recent subjects.** For subjects under 25 years old, T is at most 2 unless the change is already structural and worldwide. A subject under 150 years old reaches T 3 only if its consequences are still major today and show no sign of ending.
12. **Culture counts.** Changing how people create, see, believe or identify themselves is a real consequence. A work or artist that changed its art across many countries can reach R 3, and a monument that became a national symbol can reach R 2. Popularity alone still adds nothing.
13. **Check parts and peers.** After rating, compare each record with its whole (rule 4) and with similar subjects in other regions (rule 3), and correct any inconsistency in the ratings themselves.
14. **When unsure.** Choose the lower rating, unless thin evidence is the only reason for doubt; then use the middle rating and say so in the review notes.

## Where the ratings live

Ratings are in `atlas/importance.json`: `{ "<id>": { "r": 0, "d": 0, "t": 0, "l": 0 } }`. `node atlas/tools/importance.mjs` sets each record's `importance.score` from those ratings. Records rank by total. New records are rated on these terms when they are reviewed, and a draft's own score is replaced.
