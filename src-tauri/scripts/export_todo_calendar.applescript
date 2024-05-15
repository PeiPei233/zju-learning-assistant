on run argv
    set theSummary to item 1 of argv
    set theStartDate to item 2 of argv
    set theEndDate to theStartDate
    set theLocation to item 3 of argv
    set theURL to item 4 of argv

    set theStartDate to date theStartDate
    set theEndDate to date theEndDate

    tell application "Calendar"
        set calendarName to "Learning in ZJU"
        if not (exists calendar calendarName) then
            make new calendar with properties {name:calendarName}
        end if
        tell calendar calendarName
            set existingEvents to (every event whose summary is theSummary and url is theURL)
            if length of existingEvents is 0 then
                set newEvent to make new event with properties {summary:theSummary, start date:theStartDate, end date:theEndDate, location: theLocation, url: theURL}
                tell newEvent
                    make new sound alarm at end with properties {trigger interval:-60}
                end tell
            else
                repeat with anEvent in existingEvents
                    if start date of anEvent is not theStartDate or end date of anEvent is not theEndDate or location of anEvent is not theLocation then
                        delete anEvent
                    end if
                end repeat
                set existingEvents to (every event whose summary is theSummary and url is theURL and start date is theStartDate and end date is theEndDate)
                if length of existingEvents is 0 then
                    set newEvent to make new event with properties {summary:theSummary, start date:theStartDate, end date:theEndDate, location: theLocation, url: theURL}
                    tell newEvent
                        make new sound alarm at end with properties {trigger interval:-60}
                    end tell
                end if
            end if
        end tell
    end tell
end run
