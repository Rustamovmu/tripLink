# TripLink demo user activity — 2026-10-11

Created through the existing local GraphQL API for fictional demo offerings. No real payment, tour completion, rating, or travel-experience claim was made.

## Verified totals

| User | PENDING / UNPAID reservations | Tour favorites | ACTIVE article comments |
|---|---:|---:|---:|
| Mark | 7 | 7 | 7 |
| Alex | 7 | 7 | 7 |
| David | 7 | 7 | 7 |

Total: **21 one-seat reservations, 21 tour favorites, 21 published article comments**. Each user chose one different destination from each of the seven agents. Mark and David chose May 2027 departures; Alex chose June 2027 departures.

The tour heart action uses the existing favorites API. Reservations remain PENDING and UNPAID; seats are unchanged because the API decrements availability only upon agent confirmation. Future tours are not eligible for booking-linked reviews. Every comment starts with `[Demo]` and discusses the article without claiming a completed trip.

## Created records

### Mark

Account ID: `6acaacdadafcce4a10041446`.

#### Kevin

- Tour: [Seoul Palaces and Neighborhoods](http://localhost:3000/tour/detail?id=6acaaadfdafcce4a10040ec0).
- Reservation: `TL-MV2WRDE1-B2BF8FC6` / `6acaae6bdafcce4a1004157a`; one person; demo USD 245; departure `2027-05-15T00:00:00.000Z`; end `2027-05-16T08:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Planning a calm first visit to Seoul](http://localhost:3000/community/detail?id=6acaaae0dafcce4a10040ed1#story-discussion).
- Comment ID: `6acaae6cdafcce4a1004158b`; ACTIVE.
- Comment: [Demo] The one-palace plan and Bukchon etiquette notes make Seoul easier to plan.

#### Leo

- Tour: [Tokyo Old Streets and New Skylines](http://localhost:3000/tour/detail?id=6acaaae5dafcce4a10040f4c).
- Reservation: `TL-MV2WREFX-C09C9C89` / `6acaae6ddafcce4a10041596`; one person; demo USD 565; departure `2027-05-15T00:00:00.000Z`; end `2027-05-17T08:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [A neighborhood-first approach to Tokyo](http://localhost:3000/community/detail?id=6acaaae6dafcce4a10040f5d#story-discussion).
- Comment ID: `6acaae6ddafcce4a100415a7`; ACTIVE.
- Comment: [Demo] Choosing nearby neighborhoods sounds like a practical way to explore Tokyo.

#### Rayn

- Tour: [Rome Streets Beyond the Landmarks](http://localhost:3000/tour/detail?id=6acaaaebdafcce4a10040fd8).
- Reservation: `TL-MV2WRFI7-701FDA26` / `6acaae6edafcce4a100415b2`; one person; demo USD 645; departure `2027-05-15T07:00:00.000Z`; end `2027-05-17T15:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Planning a Rome visit without rushing](http://localhost:3000/community/detail?id=6acaaaecdafcce4a10040fe9#story-discussion).
- Comment ID: `6acaae6fdafcce4a100415c3`; ACTIVE.
- Comment: [Demo] The water, shade, and timed-entry reminders are useful for planning Rome.

#### Khan

- Tour: [Samarkand Blue Domes and Courtyards](http://localhost:3000/tour/detail?id=6acaaaf1dafcce4a10041064).
- Reservation: `TL-MV2WRGJ1-E478A94C` / `6acaae6fdafcce4a100415ce`; one person; demo USD 245; departure `2027-05-15T04:00:00.000Z`; end `2027-05-16T12:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Planning time around Samarkand's monuments](http://localhost:3000/community/detail?id=6acaaaf2dafcce4a10041075#story-discussion).
- Comment ID: `6acaae70dafcce4a100415df`; ACTIVE.
- Comment: [Demo] I like the focus on tilework and leaving time for shaded breaks in Samarkand.

#### Adam

- Tour: [Bergen Harbor and Hillside Views](http://localhost:3000/tour/detail?id=6acaaaf8dafcce4a100410f0).
- Reservation: `TL-MV2WRHKA-98425809` / `6acaae71dafcce4a100415ea`; one person; demo USD 465; departure `2027-05-15T07:00:00.000Z`; end `2027-05-16T15:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Planning Bergen with room for rain](http://localhost:3000/community/detail?id=6acaaaf8dafcce4a10041101#story-discussion).
- Comment ID: `6acaae71dafcce4a100415fb`; ACTIVE.
- Comment: [Demo] A waterproof layer and flexible indoor break belong on my Bergen checklist.

#### Ray

- Tour: [Queenstown Lakeside and Valley Escape](http://localhost:3000/tour/detail?id=6acaaafedafcce4a1004117c).
- Reservation: `TL-MV2WRIL5-0A8B19B6` / `6acaae72dafcce4a10041606`; one person; demo USD 685; departure `2027-05-14T21:00:00.000Z`; end `2027-05-17T05:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Planning a slower Queenstown visit](http://localhost:3000/community/detail?id=6acaaafedafcce4a1004118d#story-discussion).
- Comment ID: `6acaae73dafcce4a10041617`; ACTIVE.
- Comment: [Demo] Leaving space for a lakeside walk makes this Queenstown plan appealing.

#### Angel

- Tour: [Ubud Rice Landscapes and Village Routes](http://localhost:3000/tour/detail?id=6acaab04dafcce4a10041208).
- Reservation: `TL-MV2WRJMZ-8C4BFD9F` / `6acaae73dafcce4a10041622`; one person; demo USD 325; departure `2027-05-15T01:00:00.000Z`; end `2027-05-17T09:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Planning an unhurried Ubud day](http://localhost:3000/community/detail?id=6acaab04dafcce4a10041219#story-discussion).
- Comment ID: `6acaae74dafcce4a10041633`; ACTIVE.
- Comment: [Demo] The traffic buffer and authorized-path reminders are helpful for planning Ubud.

### Alex

Account ID: `6acaacaadafcce4a100413b4`.

#### Kevin

- Tour: [Busan Coast and Market Flavors](http://localhost:3000/tour/detail?id=6acaaae0dafcce4a10040eda).
- Reservation: `TL-MV2WRKOS-D4B3571B` / `6acaae75dafcce4a1004163e`; one person; demo USD 265; departure `2027-06-15T00:00:00.000Z`; end `2027-06-16T08:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Eating thoughtfully around Busan markets](http://localhost:3000/community/detail?id=6acaaae1dafcce4a10040eeb#story-discussion).
- Comment ID: `6acaae75dafcce4a1004164f`; ACTIVE.
- Comment: [Demo] Clear prices and dietary questions are useful reminders for Busan markets.

#### Leo

- Tour: [Kyoto Gardens and Temple Lanes](http://localhost:3000/tour/detail?id=6acaaae6dafcce4a10040f66).
- Reservation: `TL-MV2WRLR9-95E8B8E9` / `6acaae76dafcce4a1004165a`; one person; demo USD 595; departure `2027-06-15T00:00:00.000Z`; end `2027-06-17T08:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Finding a balanced food day in Kyoto](http://localhost:3000/community/detail?id=6acaaae7dafcce4a10040f77#story-discussion).
- Comment ID: `6acaae77dafcce4a1004166b`; ACTIVE.
- Comment: [Demo] A seasonal lunch and unhurried tea break sound like a good Kyoto food day.

#### Rayn

- Tour: [Florence Art Streets and Tuscan Tables](http://localhost:3000/tour/detail?id=6acaaaecdafcce4a10040ff2).
- Reservation: `TL-MV2WRMSP-58374FBF` / `6acaae77dafcce4a10041676`; one person; demo USD 455; departure `2027-06-15T07:00:00.000Z`; end `2027-06-16T15:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Making time for food in Florence](http://localhost:3000/community/detail?id=6acaaaeddafcce4a10041003#story-discussion).
- Comment ID: `6acaae78dafcce4a10041687`; ACTIVE.
- Comment: [Demo] Giving lunch its own time slot is a helpful idea for a Florence itinerary.

#### Khan

- Tour: [Bukhara Old City and Bazaar Traditions](http://localhost:3000/tour/detail?id=6acaaaf2dafcce4a1004107e).
- Reservation: `TL-MV2WRNUB-421B347B` / `6acaae79dafcce4a10041692`; one person; demo USD 225; departure `2027-06-15T04:00:00.000Z`; end `2027-06-16T12:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [A thoughtful food break in Bukhara](http://localhost:3000/community/detail?id=6acaaaf3dafcce4a1004108f#story-discussion).
- Comment ID: `6acaae7adafcce4a100416a3`; ACTIVE.
- Comment: [Demo] Tea and a shaded food break sound sensible during a Bukhara heritage walk.

#### Adam

- Tour: [Flam Fjordside Slow Escape](http://localhost:3000/tour/detail?id=6acaaaf9dafcce4a1004110a).
- Reservation: `TL-MV2WROVW-2C6944B1` / `6acaae7adafcce4a100416ae`; one person; demo USD 545; departure `2027-06-15T07:00:00.000Z`; end `2027-06-16T15:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [A relaxed food pause beside the fjords](http://localhost:3000/community/detail?id=6acaaaf9dafcce4a1004111b#story-discussion).
- Comment ID: `6acaae7bdafcce4a100416bf`; ACTIVE.
- Comment: [Demo] Matching meal breaks to the actual timetable is a useful tip for Flåm.

#### Ray

- Tour: [Milford Sound Scenic Nature Journey](http://localhost:3000/tour/detail?id=6acaaaffdafcce4a10041196).
- Reservation: `TL-MV2WRPWG-9C5815BB` / `6acaae7bdafcce4a100416ca`; one person; demo USD 565; departure `2027-06-14T21:00:00.000Z`; end `2027-06-16T05:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Packing a practical Fiordland picnic](http://localhost:3000/community/detail?id=6acaaaffdafcce4a100411a7#story-discussion).
- Comment ID: `6acaae7cdafcce4a100416db`; ACTIVE.
- Comment: [Demo] The picnic, water, and waste-bag checklist is useful for a Milford Sound day.

#### Angel

- Tour: [Uluwatu Clifftop Coastal Escape](http://localhost:3000/tour/detail?id=6acaab05dafcce4a10041222).
- Reservation: `TL-MV2WRQXN-4B9010D6` / `6acaae7ddafcce4a100416e6`; one person; demo USD 265; departure `2027-06-15T01:00:00.000Z`; end `2027-06-16T09:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Building a balanced food day in Uluwatu](http://localhost:3000/community/detail?id=6acaab05dafcce4a10041233#story-discussion).
- Comment ID: `6acaae7edafcce4a100416f7`; ACTIVE.
- Comment: [Demo] The water and packaging reminders are helpful for planning an Uluwatu lunch.

### David

Account ID: `6acaacc2dafcce4a100413fd`.

#### Kevin

- Tour: [Jeju Volcanic Coast Escape](http://localhost:3000/tour/detail?id=6acaaae1dafcce4a10040ef4).
- Reservation: `TL-MV2WRRZ4-58FDA92D` / `6acaae7edafcce4a10041702`; one person; demo USD 475; departure `2027-05-15T00:00:00.000Z`; end `2027-05-17T08:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Understanding Jeju beyond the postcard](http://localhost:3000/community/detail?id=6acaaae2dafcce4a10040f05#story-discussion).
- Comment ID: `6acaae7fdafcce4a10041713`; ACTIVE.
- Comment: [Demo] I appreciate the reminder to learn about haenyeo culture without interrupting work.

#### Leo

- Tour: [Osaka Street Food and City Stories](http://localhost:3000/tour/detail?id=6acaaae7dafcce4a10040f80).
- Reservation: `TL-MV2WRT1V-E6342744` / `6acaae7fdafcce4a1004171e`; one person; demo USD 325; departure `2027-05-15T00:00:00.000Z`; end `2027-05-16T08:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Reading Osaka through its street food](http://localhost:3000/community/detail?id=6acaaae8dafcce4a10040f91#story-discussion).
- Comment ID: `6acaae80dafcce4a1004172f`; ACTIVE.
- Comment: [Demo] Asking before photos and following ordering systems are useful Osaka reminders.

#### Rayn

- Tour: [Venice Waterways and Quiet Corners](http://localhost:3000/tour/detail?id=6acaaaeddafcce4a1004100c).
- Reservation: `TL-MV2WRU94-CBEBF7BE` / `6acaae81dafcce4a1004173a`; one person; demo USD 495; departure `2027-05-15T07:00:00.000Z`; end `2027-05-16T15:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Seeing Venice as a living city](http://localhost:3000/community/detail?id=6acaaaeedafcce4a1004101d#story-discussion).
- Comment ID: `6acaae82dafcce4a1004174b`; ACTIVE.
- Comment: [Demo] Keeping bridges and entrances clear is a practical way to respect daily Venice life.

#### Khan

- Tour: [Khiva Walled City Discovery](http://localhost:3000/tour/detail?id=6acaaaf3dafcce4a10041098).
- Reservation: `TL-MV2WRVC1-AB6E0CC5` / `6acaae82dafcce4a10041756`; one person; demo USD 235; departure `2027-05-15T04:00:00.000Z`; end `2027-05-16T12:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Looking closely at Khiva's architecture](http://localhost:3000/community/detail?id=6acaaaf4dafcce4a100410a9#story-discussion).
- Comment ID: `6acaae83dafcce4a10041767`; ACTIVE.
- Comment: [Demo] Looking closely without touching decorative surfaces is a good Khiva reminder.

#### Adam

- Tour: [Lofoten Villages and Coastal Light](http://localhost:3000/tour/detail?id=6acaaafadafcce4a10041124).
- Reservation: `TL-MV2WRWDI-9E53E5FF` / `6acaae84dafcce4a10041772`; one person; demo USD 1195; departure `2027-05-15T07:00:00.000Z`; end `2027-05-18T15:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Understanding Lofoten's fishing villages](http://localhost:3000/community/detail?id=6acaaafadafcce4a10041135#story-discussion).
- Comment ID: `6acaae85dafcce4a10041783`; ACTIVE.
- Comment: [Demo] The working-harbor and private-yard guidance is useful for a Lofoten visit.

#### Ray

- Tour: [Rotorua Landscapes and Cultural Context](http://localhost:3000/tour/detail?id=6acaab00dafcce4a100411b0).
- Reservation: `TL-MV2WRXF3-1671B9AA` / `6acaae85dafcce4a1004178e`; one person; demo USD 365; departure `2027-05-14T21:00:00.000Z`; end `2027-05-16T05:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Approaching Rotorua with cultural respect](http://localhost:3000/community/detail?id=6acaab00dafcce4a100411c1#story-discussion).
- Comment ID: `6acaae86dafcce4a1004179f`; ACTIVE.
- Comment: [Demo] Authorized cultural experiences and geothermal paths belong on a Rotorua checklist.

#### Angel

- Tour: [Sanur Seafront and Everyday Bali](http://localhost:3000/tour/detail?id=6acaab06dafcce4a1004123c).
- Reservation: `TL-MV2WRYGS-5DD1056D` / `6acaae86dafcce4a100417aa`; one person; demo USD 225; departure `2027-05-15T01:00:00.000Z`; end `2027-05-16T09:00:00.000Z`; PENDING / UNPAID.
- Tour favorite: verified for this user.
- Article: [Noticing everyday life around Sanur](http://localhost:3000/community/detail?id=6acaab06dafcce4a1004124d#story-discussion).
- Comment ID: `6acaae87dafcce4a100417bb`; ACTIVE.
- Comment: [Demo] Asking before portraits and keeping shore access clear are useful Sanur reminders.

## Validation

Authenticated all three identities as ACTIVE USER before writes. Inspected existing bookings, favorites, and comments; stored baselines and each created ID for resumable duplicate prevention. Read back every reservation and favorite as its owner and every comment through public lists. Verified ownership, departure IDs/dates, one-person quantities, USD prices, publication states, unchanged seat totals, and one corresponding increment in each selected tour/article counter. Existing unrelated records were preserved. No application source, schema, dependencies, credentials, passwords, or account roles changed.
