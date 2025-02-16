# LabelX

LabelX is a Google Apps Script web app that provides an interface for labeling social media profiles (or any type of data row) directly within a Google Sheet. The code in this repository helps you:

- Select which "features" (categories) you want to label.
- Randomly fetch an unlabeled row from the Sheet.
- Acquire a lock to prevent concurrency issues.
- Display relevant data (e.g., user info, tweets) for labeling.
- Capture label answers, speculation levels, and notes, then store them back into the Sheet.

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Usage](#usage)
- [Customization](#customization)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

This project uses three main files:

1. **Code.gs** — The backend server code (Apps Script) that handles `doGet`, `doPost`, and concurrency.
2. **Index.html** — The labeling UI shown to users labeling a single row.
3. **SelectFeatures.html** — A simple UI for selecting which features to label.

A Google Sheet named **"LabelX"** is used to store data. The sheet should contain at least these columns (case-sensitive):

| Notes | claimed_by | claimed_at | FeatureAnswers | start_time | completed_by | end_time |

Plus whichever data columns you want to display for labeling (e.g., `profile_image_url`, `username`, `created_at.tweet_1`, etc.).

## Setup

1. **Create a new Google Apps Script project:**
   - Go to [script.google.com](https://script.google.com/).
   - Click on **New Project**.
2. **Copy the contents** of `Code.gs`, `Index.html`, `SelectFeatures.html` into your Apps Script files.
   - You can create separate files in your script project (e.g., `Code.gs`, `Index.html`, `SelectFeatures.html`).
3. **Create or use an existing Google Sheet**:
   - Ensure it has a sheet named `LabelX`.
   - Include columns for the data you plan to label. For concurrency, add:
     ```
     Notes | claimed_by | claimed_at
     ```
     Additionally, the script will create more columns if they don’t exist:
     ```
     FeatureAnswers | start_time | completed_by | end_time
     ```
4. **Deploy as a web app**:
   - In the Apps Script editor, click **Deploy** → **New deployment**.
   - Under “Select type,” choose **Web app**.
   - Set **Execute as**: “User accessing the web app” or “User deploying the web app,” depending on your needs.
   - Choose who can access: “Anyone” or “Anyone with Google account,” etc.

5. **Open the web app URL**:
   - On first load, you should see the "Select Features" page.

## Usage

1. **Open the Web App** in a browser.
2. **Select which features** (i.e., categories) you want to label, then click “Start Labeling”.
3. The app will display a random unlabeled row from the `LabelX` sheet:
   - You’ll see user info (e.g., name, username, location, description) and any extra columns (like tweets).
   - You’ll see the selected feature categories on the right side. Complete each category’s question(s) and speculation slider.
   - Fill in any “Notes” about the row.  
   - Click “Submit & Next” to finalize and move on to the next unlabeled row.

4. **Continue labeling** until all rows are done.

## Customization

- **Feature Questions**: In `Index.html` (in the `<script>` block at the top), the `featureMap` object shows sample categories and question options. Replace them with your own domain-specific categories.
- **State / Location**: If you don’t need a location dropdown, remove or modify the `"STATE"` code block.
- **Concurrency**: The script uses [`LockService`](https://developers.google.com/apps-script/reference/lock/lock-service) to prevent multiple users from grabbing the same row. If concurrency is not a concern, you can simplify or remove that logic.
- **Timeout**: By default, a claimed row is unclaimed if not completed after `CLAIM_TIMEOUT_MIN = 10` minutes. Modify it in `Code.gs` if needed.

## Contributing

Pull requests and suggestions are welcome. For major changes, please open an issue first to discuss what you’d like to change.

## Citation

If you use this project in your research or work, please cite:

```bibtex
@misc{Cerina2025LabelX,
  author       = {Roberto Cerina},
  title        = {LabelX: A Google Apps Script-Based Labeling Platform for Social Media Profiles},
  howpublished = {GitHub repository},
  year         = {2025},
  url          = {https://github.com/robertocerinaprojects/LabelX}
}
```

## License

This project is licensed under the [MIT License](LICENSE).
