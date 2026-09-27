
export const AVAILABLE_VARIABLES = [
    {
        name: "Current Date",
        value: "{date}",
        description: "Inserts the current date (YYYY-MM-DD)."
    },
    {
        name:"User Name",
        value:"{user_name}",
        description:"Inserts the user's name."
    },
    {
        name:"User Email",
        value:"{user_email}",
        description:"Inserts the user's email."
    },
    {
        name: "Current Time",
        value: "{time}",
        description: "Inserts the current time (HH:MM AM/PM)."
    },
    {
        name: "Current Date & Time",
        value: "{datetime}",
        description: "Inserts the current date and time (YYYY-MM-DD HH:MM)."
    },
    {
        name: "Current Weekday",
        value: "{weekday}",
        description: "Inserts the current day of the week (e.g., Monday)."
    },
    {
        name: "Current Month",
        value: "{month}",
        description: "Inserts the current month (e.g., January)."
    },
    {
        name: "Current Year",
        value: "{year}",
        description: "Inserts the current year (e.g., 2024)."
    },
    {
        name: "ISO Timestamp",
        value: "{iso_timestamp}",
        description: "Inserts the current timestamp in ISO 8601 format."
    },
    {
        name: "Random UUID",
        value: "{uuid}",
        description: "Generates a random UUID v4."
    }
] as const;

export type VariableType = typeof AVAILABLE_VARIABLES[number]['value'];
