# Changelog

What changed in AniRoll, newest first: the same as "What's new" in the app. Current release: 1.9.9.6.

## 29 October 2026 – Ambient light, rebuilt

- In the player, the light in the black bars now falls off like light on a wall: brightest at the picture, fading towards the edge of the screen, without stripes. It glides into each new scene instead of jumping.

## 27 October 2026 – Your Jellyfin in My List

- The helper for **AniRoll for Discord** is built with current, patched versions of Python (Windows) and Go (Linux and macOS). On Linux and macOS it updates by itself; on Windows, Settings → Discord shows the update: set it up again the same way.
- With Jellyfin connected, My List marks the shows your Jellyfin has, keeps only those with **On Jellyfin** and sorts by **Recently downloaded**. It counts per season: the first season on disk does not make the second one count.
- With On Jellyfin on, your list also shows what your Jellyfin has that is not on your list yet.
- My List filters by **tag** too, next to the genres: the AniList tags your shows share.
- Your Discord status always has a link to AniRoll now, on Home too, and while you roll, the member list says so.

## 26 October 2026 – Covers that colour the app

- Rest the pointer on a show's card and the whole app takes on its cover and colours for a moment. Move away and your own look comes back.
- Cards wear their cover's colour, so My List, Season and Home read as a mosaic of your shows.
- Recommendations that fit your taste really well are **holo cards**: the foil and the light follow your pointer.
- When Roll lands, the pick turns through a few shapes into its card and the app takes on its colours until you leave Roll.
- Scroll past your next episode on Home and its number flies up into the top bar. A click there marks the episode as watched.
- Big titles and numbers have softer, rounder letters.
- The Roll button in the side rail is a shape that changes when you point at it and turns while a roll runs.
- On a show, Watch Party leads the actions and Hide stays quiet until it is on. Its icon is back, and the score no longer breaks onto two lines.
- Round buttons stay round while they change shape: pressing one, or pointing at the episode in the top bar, no longer shows sharp corners for a moment.

## 25 October 2026 – Followers and your 18+ settings

- Under **Friends** you now also see your **Followers** and your **Mutuals**, and can remove someone from your followers.
- With **18+ content** on in your AniList settings, AniRoll follows them: Browse, Season and the search include 18+ as you set it there, and Browse can show only 18+ or none. Other people's 18+ posts in the feed follow your AniList setting too.
- Show pages give AniList's new **Weighted Score**, with the mean score next to it.
- Leaving a page or closing a box with a reply or post you haven't sent asks before it's lost.
- Private messages are gone from the feed and the notifications as well.
- Under **Friends**, a long name no longer pushes the match onto its own line, and there is more room below Following, Followers and Mutuals.
- **What's this song?** only shows up where your browser lets AniRoll hear the episode, so not on iPhone.
- Big styled subtitles no longer go missing when you watch away from home: the player waits for them longer.
- In Firefox, the player says once that styled subtitles may flicker there, and that a Chromium-based browser shows them smoothly.
- **Test speed** in the player's Quality menu shows what reaches your device from Jellyfin and what plays smoothly. Stuttering a lot? The player offers the test itself.
- The **Previously on** recap has its own menu for audio, subtitles and quality, and the episode after it follows what you pick there.
- The audio and subtitles you pick for a show are now kept with your account, so your other devices start with them too.
- **Hide** on a show's page keeps it out of Home, Roll, Season, Browse and the calendar. A search still finds it, dimmed. Settings → Lists → Hidden anime shows everything you hid, including what you marked Not interested, and brings it back.
- Watch Party: guests who chose **Come along** stay in the party when the host switches shows, even while they watch in another tab or the Jellyfin app.

## 24 October 2026 – Your Watch Party follows you to the next show

- Joining a Watch Party, tick **Come along when the host switches shows** and you move with the party to every next show, without being asked each time.
- Hosting a **Watch Party**? Start an episode of another show in the player and the party moves there by itself. Your guests are asked whether they come along, the invite link stays the same.
- In a Watch Party as a guest, your **Discord status** stays on even when AniRoll is in the background.

## 23 October 2026 – Your show in Discord, and a helper that updates itself

- Specials and OVAs with a single episode now play when Jellyfin keeps them as a film.
- Buffering again and again away from home? In Auto, the player now steps the quality down by itself and plays on from the same spot. Picking Auto again in the menu starts fresh.
- Settings → Jellyfin takes your server's upload: away from home the player stays below it, and files whose bitrate jumps a lot (Blu-rays) are converted instead of stuttering.
- While you watch, your **Discord status** says **AniRoll:** and the show, in the member list too. It needs the newest helper: Settings → Discord shows the update.
- AniRoll for Discord's helper can **update itself**. Turn it on when you set it up, or later with one line in the terminal; Settings → Discord shows both.

## 22 October 2026 – Live now, Undo, and double tap in the player

- **Live now** on Social shows who of the people you follow is watching what, right now. Only people who turn on *Show when I'm watching* in Settings appear; it's off unless you do.
- In the player on a phone, double tap left or right to skip 10 seconds back or forward, or the middle for fullscreen. Moving along the bar shows preview pictures when Jellyfin has them.
- Removing a show from your list or deleting a post or reply happens at once, and **Undo** brings it back for a few seconds. No more “Are you sure?”.
- Press **?** for the keyboard shortcuts, in the player too.
- In the calendar, friends' faces show in the month view too, and whether you share yours is visible only to people who follow you. Calendar files open cleanly in every calendar app, even with Japanese titles or emoji.
- Your devices stay in step: a short hiccup can't overwrite what another device saved, and what you remove stays removed everywhere.
- Shows with several seasons have a **Watch order**: by release and, where it differs, by story.
- If AniList is down, AniRoll keeps working: shows open with their basics from TMDB, changes you make are kept and sent when AniList is back, and Jellyfin, Watch Parties and your seat keep working. Nothing is lost; everything catches up.

## 21 October 2026 – Watch Parties that change shows

- When AniList doesn't answer, the start page now says so and offers **Try again** instead of showing empty cards.
- Small design touches: calmer labels, headings that break more evenly, buttons that react faster on touch, and menus that no longer scroll the page behind them.
- In Firefox, the edge of a side-scrolling row (like Continue Watching) no longer flickers or disappears while you move over the covers.
- When the host switches a Watch Party to another show, members are now asked whether they come along. Say no and the new show stays off your list; the one you watched stays where you got to.
- The party page shows what the party watched earlier and with whom, and **End & Post** says who watched which show when the group changed.
- The **Watch Party** button on Home now picks from all your lists, like Switch anime: a show from Planning goes on Watching, a completed one becomes a rewatch.

## 20 October 2026 – What's this song? And your accounts

- AniRoll for Discord on Windows: the helper is now set up with one line in PowerShell instead of a program to download, so Windows' Smart App Control no longer blocks it: it runs on Python, which is signed by the Python Software Foundation, and Windows trusts that. Already have the old one? Settings → Discord shows the update.
- New in the player: **Songs** in the settings menu lists the episode's opening and ending, and the player names them as they start. **What's this song?** listens for a few seconds and tells you what is playing, with links to Shazam, Spotify and YouTube Music. Only a fingerprint of the sound goes out, through AniRoll, never the sound itself.
- **Add account** now opens AniList in a small window and AniRoll stays where you are. Shows the account you already have? Sign out in that window and sign in with the other one. The note about it stays until you close it.
- Several AniList accounts in one browser: switch between them from the profile menu, or add one in **Settings → Account**. Each keeps its own settings and Jellyfin connection.
- **Delete all my AniRoll data** in Settings → Account removes everything AniRoll keeps for your account, on the server and in this browser, in one step. Your AniList list stays as it is.
- The profile menu is shorter and clearer: you on top, your other accounts below, then just what you need.

## 19 October 2026 – One post per binge

- When a new version of AniRoll comes out while you have it open, a note offers a **reload**. After an update only what changed is downloaded again.
- Coming back to **Home** no longer stutters for a moment. The Discord helper's remover on Windows now works on the first run, even with the browser open.
- Text posts join in too: an evening of episodes and the Watch Party post after it now show as one post.
- In **Social**, when someone updates several shows in a row, you now see one post with a row per show: cover, title and what they watched, each with its own likes and replies.

## 18 October 2026 – Try your Anime DNA

- **Follow** people right from their profile in AniRoll, and delete your own posts and replies in Social, no trip to AniList needed.
- The start page now shows **Anime DNA**: flip through three example viewers, or type your AniList name to see your own without logging in.
- The **ambient light** in the player now follows the picture without lagging behind, also on wide 21:9 screens.

## 17 October 2026 – Any list for your party

- Switching the anime of a **Watch Party** now offers every list: Watching, Planning, Paused, Completed and Dropped, one tab each.
- Your **Discord status** clears itself when AniRoll sits in a background tab for about two minutes with nothing playing, and comes back as soon as you return.

## 15 October 2026 – Back where you were

- In the installed app there is now a **back button** next to the logo, and a swipe from the left edge goes back too.
- The phone’s back button closes an open panel or dialog first instead of leaving the app.

## 14 October 2026 – Subtitles make room

- Styled and Blu-ray subtitles now move up a little while the player controls show, like plain ones do.

## 13 October 2026 – Your friends’ calendars

- Less about you on the server: error reports keep only the browser and system, Watch Party pictures come only from AniList, and backups are kept for 14 days.
- Plain subtitles (SRT and the like) now look like proper ones: larger, white with a dark outline, no grey box, and out of the way of the controls.
- AniRoll opens faster, and sign-in is safer: it only takes a login this browser asked for. The server no longer keeps logs with IP addresses.
- Fixes: leaving the player while it asks where to continue, changes waiting offline getting lost, the calendar and search showing an older result after quick clicks, and the countdown on Home.
- The **Calendar** can show what the people you follow are watching: pick **Friends**, and each episode shows who watches it. A tap on a face shows only theirs.
- Only for people who turned it on: share your own calendar in **Settings → Lists**. It is off until you do.

## 12 October 2026 – Pause the recap

- Styled subtitles in **Firefox** and Zen should blink even less now.
- **Previously on** can now be paused, switched to full screen and shown with subtitles (Space, F, C). Subtitles switched there stay for the episode after it.
- Notes in the player, like a saved episode, now appear at the top right instead of over the subtitles.
- **AniRoll for Discord**: Watch Party guests now show the show, the party’s episode and its cover, like the host. AniRoll also points out when the browser extension has an update.

## 11 October 2026 – Steadier subtitles in Firefox

- Styled subtitles in **Firefox** and Zen should no longer blink away for a moment.
- What’s new shows every change of a busy day again: the tenth release of a day no longer counts as older than the ninth.

## 10 October 2026 – Your Anime DNA

- The **Watch Party** post now names every show of the evening, also after switching from the player, and says when a show was finished or completed.
- How well do you **match**? Anyone’s profile now shows it in percent: what you both love, where you part ways, and what they loved that you have not seen. Social shows it next to every friend, your profile your closest tastes.
- **Share your DNA**: a card with your picture and type, as a link that shows it in Discord & co. Whoever opens it sees how well you match. Your profile also keeps how your DNA changes, month by month.
- **Anime DNA** on your profile: what kind of viewer you are, quirks you never counted (the episode you usually drop a show at, the studio that never misses), and a picture only your list draws. It changes as you watch, and works on anyone’s profile.
- **Previously on**: back to a show after two weeks or more, the last minute of the episode before plays first, right up to its ending. It never counts as watched.
- **Ambient light** in the player: where the picture leaves black bars (a 16:9 episode on a wide screen, a narrow window), they glow in its colours, scene by scene. A switches it, or the player menu.
- One player menu with pages: audio and subtitles, quality and speed each open their own, so nothing needs scrolling.
- Home’s countdown shows the next episode your calendar shows, and moves on an hour after it is out.
- When AniRoll for Discord’s helper has an update, AniRoll tells you once and shows how to get it.
- The **legacy design** is gone: AniRoll is Material 3 Expressive for everyone now. Settings → Discord also shows how to remove AniRoll for Discord again.
- AniRoll for Discord now works in **Firefox**, Zen and LibreWolf too.
- Your **Discord status** can now show what you watch in AniRoll: the episode with the time left, the show you look at, your Watch Party with a button to join. Set it up under Settings → Discord.
- Pick any episode right in the **player**: the new Episodes button (or E) lists every episode in your Jellyfin, the one playing marked, with the seasons before and after one click away.
- With live tracking off, the AniRoll server no longer keeps the list of shows in your **Jellyfin** library; turning live tracking off now deletes it, along with episodes still waiting to be saved.

## 9 October 2026 – Up next waits for the story

- AniRoll now finds shows in your **Jellyfin** that Jellyfin names differently from AniList, and later parts that share a season, the moment your server is back online. Watching them in Jellyfin itself counts the right entry too.
- Your **Watch Party** in the player: starting one says so right there, and the party button then shows who is in and how far, marked when someone's sync fell behind. End the party from there too, with or without a post.
- In the player, **Up next** now knows where an episode really ends: a scene after the credits plays before it shows up, and credits with story in them can no longer be skipped by accident.
- Installed on an iPhone, AniRoll no longer hides its top bar under the status bar.
- Search results can now show the AniRoll logo.

## 8 October 2026 – AniRoll moved to aniroll.app, and a calmer look

- When none of your shows has a new episode yet, the big card on Home says when the next one airs and offers a **Roll** instead of a big number. With nothing left to watch, the small card next to it says you are caught up.
- Show cards say one thing at a glance: how many episodes are waiting, or when the next one airs. Rows that go on to the side fade out at the edge.
- Show pages are quieter: the facts read as two short phrases, tags and recommendations drop their extra percentages, and where to watch it sits with the other links at the end.
- Pages show their outline while they load instead of a spinner.
- AniRoll now lives at **aniroll.app**. Old links still work and bring you here, and you stay logged in with your Jellyfin and settings.
- The roll on the front page stops exactly on one cover, without an edge of the next one showing, and every cover is there while it spins.
- AniRoll can now be found through Google and other search engines.

## 6 October 2026 – A tidier show page and a new front page

- The big card on Home is about a show with an episode **ready to watch**, instead of one that is still waiting for its next episode.
- Show pages are calmer: the facts under the score are one line of text, the eight most fitting tags come first, and **Remove from list** moved into the status menu.
- A show that just arrived on your Jellyfin gets its **Play** button after a minute, not ten.
- Profiles without a banner of their own use the avatar instead of an empty grey block.
- Show pages are much shorter: the **score** sits right under the title, and Characters, Reviews, Stats and the Trailer each have their own **tab**.
- When the countdown on Home is already about the show you are on, the clock next to it shows the episode after that.
- The tools on **My List** no longer get cut off when they wrap onto a second row, and the post you write after a Watch Party has room for its text.
- The front page lets you **roll a show** right away and shows what a Watch Party invite looks like.

## 5 October 2026 – Premieres in your week

- **Your week** on Home now shows the premieres from your Planning list too, not just the shows you are watching.
- Planned shows that already started count in **Your week** as well, on the day they air.
- **What’s new** in the profile menu opens a page of its own now, with a button back to where you were. New features still greet you in a pop-up.
- Other people’s profiles open faster: AniRoll keeps them for a while instead of asking AniList every time.

## 4 October 2026 – A smarter player, your list at a glance, and a faster start

- The countdown on Home shows the show’s cover, a ring that fills up until it starts, and when it airs. The last hour counts down to the second.
- AniRoll has a version number now: you find it next to the title of What’s new.
- **Start a Watch Party right from the player**: one button, and the invite link is in your clipboard. Starting a party anywhere else copies the link too.
- The player shows the file’s **chapters** on the wave, with their names when you point at them.
- Skip intro and Skip credits step aside after a few seconds, and Watch credits really means it.
- **Play the next episode right from Home**: the Up next card has a Play button when your Jellyfin has the episode.
- Watch Party invites show the show you are on right now in Discord and other chats: copy the link again after switching shows.
- Watch Parties are live: the host’s next episode, who joined, votes and “Roll together” reach everyone within a second instead of up to half a minute.
- **Play the next episode right from the Watch Party**, from your own Jellyfin, with every other episode one tap away. The host’s counter follows what you play.
- The player answers every key: volume, speed (**[** and **]**), subtitle timing (**Z** and **X**), **0–9** to jump, **Shift+N** for the episode before. Speed, subtitle timing and size are in the menus too.
- **Skip intros automatically**, with Undo: for every show under Settings → Jellyfin → Player, or for one show in the player. Intro and credits show on the wave, and the label above it says when you are in one.
- Up next shows the episode’s picture and length. After a few episodes in a row it asks whether you are still watching, and **Stop after this episode** waits for you.
- Finished a show? Rate it right there: on the player’s last card, or when +1 completes it on Home or My List.
- Media keys, headset buttons and the lock screen control the player; the tab shows the episode.
- Jellyfin marks only the right season as played now, and only when your progress changed. Files with two episodes count as both. A series AniRoll cannot match can be **linked by hand**, even when its second part starts at episode 13.
- Invite friends to your Jellyfin with a link: it opens AniRoll with your server filled in.
- My List: an **All** tab, **Behind** and genre filters, more ways to sort, your score in one tap, an **export** for MyAnimeList, and changes from anywhere show at once.
- Home tells you what aired since your last visit and how long catching up takes; shows you have not touched in weeks can go to Paused in one tap.
- **Not interested** on a recommendation keeps it away, on every device.
- Search finds your own shows from the first letter. Related titles say where they stand on your list and add a sequel with one tap.
- Social hides posts and replies about episodes you have not seen yet, and a binge shows as one post. Notifications include mentions and messages, and open the thread right there.
- Watch Party: rate each episode together, edit the post before it goes out, see who else is watching, and invite links show the show in chat apps.
- Roll: the match for your own Planning shows, **Fits you best**, and a time filter: tonight, a weekend, or a long haul.
- Calendar: **Add to my calendar** puts the week into your phone’s calendar.
- AniRoll starts faster, and saving an episode no longer reloads your whole list.
- Easier to use with a keyboard and a screen reader, and on phones the details slide up as a proper sheet.

## 2 October 2026 – Next episode, and intros to enjoy

- A **Next episode** button sits next to the time in the player; N does the same.
- **Skip intro** and **Skip credits** step back after a few seconds, so the opening can play on its own. Move the mouse and they are there again.
- Connected to Jellyfin with an API key? Episodes you finish in AniRoll now count as **played in Jellyfin** too, and it remembers where you stopped.
- What you confirmed here stays confirmed on every device you sign in on: this list pops up once per change, not once per browser.
- The player **reconnects by itself** when the stream drops, right where it stopped; Try again continues there too.
- After the last episode you have, a card says what is next: when the next one airs, whether it is missing from your library, or the **next season** to add to Planning.
- Offline for a moment? Changes to your list are kept and go out as soon as you are back.

## 1 October 2026 – Browse by tag

- The **tags** on a show’s page open Browse with every show that carries them; tap the tag chip there to switch it off again.
- The wave on the player’s progress bar moves a little calmer.
- The **subtitles** you pick stay for the next episode of the show, switched off included.
- After a Watch Party, its post and your friends’ episodes show in Social right away instead of minutes later.
- Rewatches in Social say which time it is: **rewatched a 2nd time**, only in AniRoll.
- Nothing you watch airing right now? The **countdown** on Home counts down to the next show from your Planning list instead.

## 30 September 2026 – Material 3 for everyone, and your Jellyfin right in AniRoll

- **Material 3 Expressive** is AniRoll’s design now, in the colours of the show you watched last. The first design stays under Settings as **Legacy design**.
- The colour style (Tonal, Vibrant, Expressive) now also shapes the colours taken from your show.
- Shows in your Jellyfin library get a **Play** button: episodes play in AniRoll, and finishing one ticks it off on AniList.
- It picks up where you stopped, and Jellyfin only converts what your browser can’t play.
- **Subtitles** look the way the release made them: styled signs and karaoke with the file’s own fonts, and Blu-ray subtitles too.
- **Skip intro**, recaps and credits with one press, when your server knows where they are.
- When the credits roll, **Up next** counts down to the next episode; its subtitles are already waiting. Rather see the credits? **Watch credits**, and it asks again at the very end.
- Dual audio? Pick the **audio track** next to the subtitles; AniRoll keeps it for the rest of the show.
- An episode you stopped part-way asks: **Continue** where you left off, or **Start over**. Your place follows you to any device through Jellyfin.
- The gear sets the **quality**: Auto measures your connection, Maximum plays the original, or pick a bitrate. **Stats for nerds** (I) shows what plays and how.
- **Episodes** next to Play lists every episode your Jellyfin has, with the seasons before and after: start any of them, for a rewatch or one you skipped.
- Signing in to Jellyfin works with **Quick Connect**: confirm a code in Jellyfin, no password typed into AniRoll.

## 28 September 2026 – Starting soon, studios, voice actors and a fairer Roll

- Home shows what’s **starting soon** from your Planning list, with how long until its first episode.
- My List can be **filtered by format**: TV, movies, OVAs, ONAs or specials, one tap on a chip.
- A show’s **studios** are cards now, and each opens a **studio page** with everything they made.
- Related shows appear as **covers** you can scroll through, not as a list of names.
- **Roll** no longer picks the same show again soon: every show gets its turn before one comes back.
- Every character shows their **voice actor**; tap one to see all the anime they voice, and who they play there.
- Tags that give away the story stay hidden until you tap **Show spoiler tags**.
- Material 3: progress runs as a wave up to a round dot, like Android’s media player; after it the line goes on flat.
- Material 3: the **Watch Party** page got a new look — the show’s banner behind it, a big episode counter, the people and the invite on the side.

## 27 September 2026 – A new Home, and Material 3 follows your pointer

- **Home** opens on the show you’re on: its banner, your progress and **Watched episode N** right there.
- Below it: a **live countdown** to your next episode, what’s ready to watch, what airs this week.
- Continue Watching starts with your second show, so nothing appears twice.
- In Material 3 the **pointer takes the shape** of what it points at: a cookie on buttons, a flower on shows.
- Material 3: every cover on Home opens its show, and the detail panel pushes the page aside.
- Material 3: the progress wave ends in a dot, on top or at the bottom, wherever the wave stops.
- **Fixed:** joining a Watch Party failed with an error for a few hours. It works again.
- Scores are always **out of 100** in AniRoll. Scores kept as 10 points, 5 stars or smileys on AniList are converted.
- **Fixed:** with a 10 point, 5 star or smiley format on AniList, My List showed some scores wrong.

## 26 September 2026 – Material 3 Expressive, your own colours, scores your way

- A second design: **Material 3 Expressive**. Switch it on in Settings → Appearance.
- It wears the colours of the **show you watched last**: its cover becomes a soft wallpaper and every surface follows. Or choose a palette of your own.
- Home opens on your next episode, with widgets for the next airing, what’s ready to watch and your week.
- Everything answers your touch: ripples, springy motion and a little burst for every episode you mark.
- Pick **any colour by hex code** in both designs: type it in or use the colour picker.
- Scores follow your **AniList score format**: 100 points, 10 with or without decimals, 5 stars or 3 smileys.
- Jellyfin no longer undoes an episode count you corrected by hand.

## 25 September 2026 – Roll recommendations, tidier settings, a livelier front page

- Roll can include **recommended titles** that are not on your list yet: tick “Include recommended titles”.
- A recommended pick shows its match and why it was suggested, with **Plan to Watch** right there.
- The front page shows AniRoll in action: short clips of Roll, My List, the calendar and the taste match.
- The top bar turns frosted once you scroll, so the page glides softly underneath.
- **Settings** are sorted into tabs: Appearance, Lists, Watch Party and Jellyfin.

## 22 September 2026 – A roomier calendar week

- The week view uses the full width of big screens; days fill their column.
- Time first, bigger covers, titles up to three lines.
- Your shows show where you stand: **Next up**, **N behind**, **Watched** or **Planning**.

## 22 September 2026 – Navigation and calendar

- Five tabs: Home, My List, Roll, Discover, Social. Browse, Season and Calendar now live under **Discover**.
- The calendar opens on **this week**, with airing times. Month is one click away.
- My List → Planning: **Roll from this list**.
- Posts show headings, lists and quotes. **Reply** in a thread mentions that person.
- Every card and list entry opens with the keyboard; dialogs close with Escape.
- Respects “Reduce motion” in your system settings.
- Fonts come from AniRoll itself — nothing is loaded from Google any more.
