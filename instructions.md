Concept:
A piece of lyrics is made for each task, for example, the task is to build a robot.
Than, the user split the task into subtasks at the very beginning, for example:
1. Subtask 1: CAD the robot
2. Prototype the robot
3. Built the robot
They can add or delete these subtasks during the process as well. (buttons for add and delete)

Daily routine:
At the end of each day, respond to these two buttons:
1. Today’s effort level:
    1. [ Barely did anything (0.5h) ]  [ Touched on it a little (1h) ]  [ Worked on it for a while (2.5h) ]  [ Fully immersed (4h) ]  [ Other ]
ps(The first four options log the number of hours shown in their brackets, with no field to fill in. "Other" is there for when the user wants to be more precise: picking it reveals an hours field, and the number they type in is what gets logged.)
1. Today’s mood for the project:
    1. 😞  😐  🙂  😄

There's always a button alongside to let the user choose whether the subtask is done or not. This is a manual decision (there’s no more estimated hour for each subtask)

If the user works on more than one subtask on the same day, both get logged separately but tagged to the same day, this is what tells the music side to play a chord instead of a single note for that day
Users can also give up on a subtask instead of completing it (a button for give up)
* If they do, the data collected so far isn't deleted, it still gets turned into music, just with an "unresolved" feeling instead of a resolved one
* So giving up still leaves a trace in the final song, instead of disappearing without a sound
When a subtask is marked complete or given up, the app moves on to the next subtask
This repeats until the whole big task is done

Once everything is finished, all the pieces get stitched together into one full song with lyrics, representing the entire journey from start to finish

Tech Stack:
1. UI and frontend:
    1. Add/Delete subtask buttons and input fields (name + estimated hours)
    2. Daily check-in screen: 4 effort-level buttons (each logging its bracketed default hours) plus an "Other" button that reveals an hours field for a typed-in number, and 4 mood buttons (emoji)
    3. Submit button for the daily log
    4. Complete / Give Up buttons for the current subtask
    5. Display current subtask list and progress
    6. Play button that calls the Music layer's playSong() function
    7. Display generated lyrics once the song is ready


1. Logic and functions:
    1. Add a subtask (with a name and an estimated number of hours)
    2. Delete a subtask
    3. Mark a subtask as completed (manual action, not automatic)
    4. Mark a subtask as given up (data is kept, not deleted)
    5. Log a daily entry for a subtask: effort level, hours (from the effort level, or typed in by the user when they pick "Other"), and mood
    6. Group same-day entries across subtasks together, so Music knows when to play a chord instead of a single note
    7. Provide the full, ordered data for the whole goal once everything is finished, so Music can generate the complete song 

1. Music generation:
    1. Map each day's effort level to note duration/density
    2. Map each day's mood to pitch/mode (major vs. minor)
    3. Play a single note for a day with one subtask logged, or a chord for a day with multiple subtasks logged
    4. Give completed subtasks a resolved musical phrase (resolving toward the tonic chord)
    5. Give given-up subtasks an unresolved musical phrase (e.g. ending on a suspended or dissonant note)
    6. Generate lyrics based on the mood trend and the goal's overall duration (longer goals → longer lyrics)
    7. Stitch all subtask segments together in order into one final playable song once the whole goal is done
    8. Expose a single function (e.g. playSong()) that the UI can call without needing to understand the music logic inside
