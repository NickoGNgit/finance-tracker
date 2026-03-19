Finance Tracker Pro - Installation Instructions

This application has been split into multiple files to ensure maximum stability and offline performance.

Folder Structure

To set this up correctly on your local machine, please create a root folder (e.g., Tracker) and recreate the exact folder structure below:

/Tracker
│
├── index.html          (Your main HTML interface)
│
├── /styles
│   └── styles.css      (All CSS styling and theming)
│
└── /script
├── app.js          (All functional Javascript logic)
└── chart.js        (The offline Chart.js library file)

Steps to Run

Ensure all 4 files are saved into their respective folders.

Double-click index.html to open it in your preferred web browser (Chrome, Edge, Safari, etc.).

The application will run entirely offline. Your data is saved securely to your browser's LocalStorage.

Using the Save/Load Feature

Since data is stored in the browser, if you clear your browser history or cache, your data will be lost.

Periodically click Save File in the sidebar to download a secure .json backup of your data.

If you move to a new computer, simply click Load File and select your .json backup to instantly restore all categories, inputs, and loans.