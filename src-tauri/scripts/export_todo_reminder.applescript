on run argv
    set theTitle to item 1 of argv
    set theEndDate to item 2 of argv
    set theLocation to item 3 of argv
    set theURL to item 4 of argv

    if theEndDate is "None" then
        set theEndDate to missing value
    else
        set theEndDate to date theEndDate
    end if
    set theTitle to theTitle & " - " & theLocation
    set theBody to theURL

    tell application "Reminders"
        set existingReminder to (every reminder whose name is theTitle and body is theBody)
        if length of existingReminder is 0 then
            if theEndDate is missing value then
                set newReminder to make new reminder with properties {name:theTitle, body: theBody}
            else
                set newReminder to make new reminder with properties {name:theTitle, remind me date:theEndDate, due date:theEndDate, body: theBody}
            end if
        else
            repeat with theReminder in existingReminder
                if theEndDate is missing value then
                    delete theReminder
                else
                    set remind me date of theReminder to theEndDate
                    set due date of theReminder to theEndDate
                end if
            end repeat
            if theEndDate is missing value then
                make new reminder with properties {name:theTitle, body: theBody}
            end if
        end if
    end tell

end run
