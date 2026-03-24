// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyCuukqiTFKjTxlSCIS6u531jn-nY9S3A5o",
  authDomain: "finance-tracker-d33f4.firebaseapp.com",
  projectId: "finance-tracker-d33f4",
  storageBucket: "finance-tracker-d33f4.firebasestorage.app",
  messagingSenderId: "509834347574",
  appId: "1:509834347574:web:cfd6d606a10dbff0694497"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let isOfflineMode = false;
let quillEditor = null; // Rich text editor instance

// Initialize appData with defaults.
let appData = { 
    categories: [ { id: 'cat_savings', name: 'Savings', goal: '', goalType: 'weekly', isDeletable: false } ], 
    rows: [], payables: [], receivables: [], savingsAccounts: [], activityLog: [] 
};

// Activity Log Timer State
let logDebounceTimers = {};

let charts = { combinedLine: null, expenses: null, cc: null };
let activePeriodIndex = "ALL";
let activeMobilePeriodIndex = null;
let isMobileView = window.innerWidth <= 768;

const moonIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
const sunIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;

let isDarkTheme = localStorage.getItem('trackerTheme') === 'dark';
if (isDarkTheme) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeIcon').innerHTML = sunIcon;
    document.getElementById('themeText').innerText = "Light Mode";
    document.getElementById('mobileThemeIcon').innerHTML = sunIcon;
}

// Ensure Quill is initialized once DOM loads
document.addEventListener("DOMContentLoaded", () => {
    // Init Quill Editor
    quillEditor = new Quill('#richTextEditor', {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['link', 'clean']
            ]
        }
    });

    // Handle Authentication resolution and hide spinner
    auth.onAuthStateChanged(user => {
        document.getElementById('initialLoader').style.display = 'none';
        
        if (user) {
            currentUser = user;
            document.getElementById('landingPage').style.display = 'none';
            document.getElementById('btnProfileSignOut').style.display = 'block';
            
            // Populate Profile Data
            document.getElementById('profileUserName').innerText = user.displayName || 'Finance Tracker User';
            document.getElementById('profileUserEmail').innerText = user.email || '';
            
            loadDataFromFirebase();
        } else {
            document.getElementById('btnProfileSignOut').style.display = 'none';
            if(!isOfflineMode) {
                document.getElementById('landingPage').style.display = 'flex';
            }
        }
    });
});

function toggleTheme() {
    isDarkTheme = !isDarkTheme;
    document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
    localStorage.setItem('trackerTheme', isDarkTheme ? 'dark' : 'light');
    document.getElementById('themeIcon').innerHTML = isDarkTheme ? sunIcon : moonIcon;
    document.getElementById('themeText').innerText = isDarkTheme ? "Light Mode" : "Dark Mode";
    document.getElementById('mobileThemeIcon').innerHTML = isDarkTheme ? sunIcon : moonIcon;
    
    if(typeof Chart !== 'undefined') {
        Chart.defaults.color = isDarkTheme ? '#94a3b8' : '#64748b';
        Chart.defaults.borderColor = isDarkTheme ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.25)';
        if(document.getElementById('view-summary').style.display === 'block') renderCharts();
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function openMobileSidebar() {
    document.getElementById('appSidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
}

function closeMobileSidebar() {
    document.getElementById('appSidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

function toggleSidebar() { 
    if (window.innerWidth <= 768) {
        closeMobileSidebar();
    } else {
        document.getElementById('appSidebar').classList.toggle('collapsed'); 
    }
}

function toggleEntries(id, btnElement) {
    const el = document.getElementById(id);
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (btnElement) btnElement.innerHTML = 'Show Less';
    } else {
        el.style.display = 'none';
        if (btnElement) btnElement.innerHTML = 'Show More History';
    }
}

function toggleLogDetails(id) {
    const el = document.getElementById(id);
    const icon = document.getElementById(id + '_icon');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
    } else {
        el.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
    }
}

// --- ACTIVITY LOG SYSTEM ---
function logActivity(title, details) {
    if (!appData.activityLog) appData.activityLog = [];
    const now = new Date();
    
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const dateStr = formatDateToText(now.toISOString().split('T')[0]) + ' ' + now.toLocaleTimeString('en-US', timeOptions);
    
    appData.activityLog.unshift({
        id: generateId(),
        timestamp: now.toISOString(),
        dateStr: dateStr,
        title: title,
        details: details
    });
    
    if (appData.activityLog.length > 500) appData.activityLog.pop();
    saveData(true);
}

function renderActivityLog() {
    const container = document.getElementById('activityLogContainer');
    if (!container) return; // if not in DOM yet
    
    const fromDateStr = document.getElementById('logFilterFrom').value;
    const toDateStr = document.getElementById('logFilterTo').value;

    let fromTime = fromDateStr ? new Date(fromDateStr + 'T00:00:00').getTime() : 0;
    let toTime = toDateStr ? new Date(toDateStr + 'T23:59:59').getTime() : Infinity;

    let filteredLogs = appData.activityLog || [];
    
    if (fromTime > 0 || toTime < Infinity) {
        filteredLogs = filteredLogs.filter(log => {
            const logTime = new Date(log.timestamp).getTime();
            return logTime >= fromTime && logTime <= toTime;
        });
    }

    if (!filteredLogs || filteredLogs.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);">No activity records found.</div>';
        return;
    }

    let html = '';
    filteredLogs.forEach(log => {
        html += `
            <div class="log-item card" style="margin-bottom: 0.2rem; padding: 0.75rem; box-shadow: none;">
                <div class="log-summary" onclick="toggleLogDetails('log_details_${log.id}')" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-main);">${log.title}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem;">${log.dateStr}</div>
                    </div>
                    <svg id="log_details_${log.id}_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; color: var(--text-muted); transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div id="log_details_${log.id}" class="log-details" style="display: none; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed var(--border); font-size: 0.8rem; color: var(--text-muted); white-space: pre-wrap;">${log.details}</div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function clearActivityLog() {
    customConfirm("Are you sure you want to clear the activity log?", () => {
        appData.activityLog = [];
        saveData(true);
        renderActivityLog();
        showToast("Activity log cleared.", "info");
    });
}
// ---------------------------

if(typeof Chart !== 'undefined') {
    Chart.defaults.color = isDarkTheme ? '#94a3b8' : '#64748b';
    Chart.defaults.borderColor = isDarkTheme ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.25)';
    Chart.defaults.font.family = "'Inter', sans-serif";
}

let promptCallback = null;
function customPrompt(title, defaultText, callback) {
    document.getElementById('promptTitle').innerText = title;
    const input = document.getElementById('promptInput');
    input.value = defaultText || '';
    promptCallback = callback;
    document.getElementById('customPromptModal').showModal();
    input.focus();
}
function executePrompt(isConfirm) {
    document.getElementById('customPromptModal').close();
    if (isConfirm && promptCallback) promptCallback(document.getElementById('promptInput').value);
}

let confirmCallback = null;
function customConfirm(msg, callback) {
    document.getElementById('confirmMessage').innerText = msg;
    confirmCallback = callback;
    document.getElementById('customConfirmModal').showModal();
}
function executeConfirm(isConfirm) {
    document.getElementById('customConfirmModal').close();
    if (isConfirm && confirmCallback) confirmCallback();
}

function generateId() { return 'id_' + Math.random().toString(36).substr(2, 9); }

function getCurrentPayoutIndex() {
    const now = new Date();
    now.setHours(0,0,0,0);
    let nextRowIdx = -1;
    let minDiff = Infinity;
    
    appData.rows.forEach((r, idx) => {
        let d = new Date(r.date);
        d.setHours(0,0,0,0);
        if (!isNaN(d)) {
            let diff = d - now;
            if (diff >= 0 && diff < minDiff) {
                minDiff = diff;
                nextRowIdx = idx;
            }
        }
    });
    return nextRowIdx;
}

function updateNextPayoutReminder() {
    const now = new Date();
    now.setHours(0,0,0,0);
    
    let nextRow = null;
    let minDiff = Infinity;
    
    for (let r of appData.rows) {
        let d = new Date(r.date);
        d.setHours(0,0,0,0);
        if (!isNaN(d) && d >= now) {
            let diff = d - now;
            if(diff < minDiff) {
                minDiff = diff;
                nextRow = r;
            }
        }
    }
    
    const reminderEl = document.getElementById('nextPayoutReminder');
    if(reminderEl) {
        if (nextRow) {
            let diffDays = Math.ceil(minDiff / (1000 * 60 * 60 * 24));
            let dayText = diffDays === 1 ? "tomorrow" : `in ${diffDays} days`;
            if (diffDays === 0) dayText = "today";
            reminderEl.innerHTML = `⏱ Next payout ${dayText} (${nextRow.date})`;
        } else {
            reminderEl.innerHTML = '';
        }
    }
}

// --- FIREBASE SYNC INTEGRATED INTO SAVEDATA ---
function saveData(silent = false) { 
    localStorage.setItem('allocTracker2026', JSON.stringify(appData)); 
    
    if (currentUser && !isOfflineMode) {
        db.collection("users").doc(currentUser.uid).set({
            trackerData: JSON.stringify(appData),
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(error => {
            console.error("Cloud sync failed:", error);
            showToast('Failed to sync to cloud. Saved locally.', 'error');
        });
    }

    updateDashboardMetrics(); 
    updatePeriodFilterOptions(); 
    if (!silent) showToast('Changes saved automatically.', 'info');
}

function fullRender(preserveFocus = false) { 
    let activeId = null, start = null, end = null;
    if (preserveFocus && document.activeElement && document.activeElement.tagName === 'INPUT') {
        activeId = document.activeElement.id;
        start = document.activeElement.selectionStart;
        end = document.activeElement.selectionEnd;
    }

    saveData(true); 
    updateNextPayoutReminder();
    renderTable(); 
    renderPayables();
    renderReceivables();
    renderSavingsTracker();
    if(document.getElementById('view-summary').style.display === 'block') renderCharts(); 
    if(document.getElementById('view-profile').style.display === 'block') renderActivityLog();

    if (preserveFocus && activeId) {
        let el = document.getElementById(activeId);
        if (el) { el.focus(); try { el.setSelectionRange(start, end); } catch(e){} }
    }
}

function formatPHP(amount) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount || 0); }

function formatForInputDisplay(num) {
    if (num === '' || num === undefined || num === null) return '';
    let valStr = num.toString();
    let parts = valStr.split('.');
    let intPart = parts[0];
    if (intPart) intPart = parseInt(intPart, 10).toLocaleString('en-US');
    return parts.length > 1 ? intPart + '.' + parts[1] : intPart;
}

function formatInputInPlace(inputElement) {
    let cursorPosition = inputElement.selectionStart;
    let originalLength = inputElement.value.length;
    
    let isNegative = inputElement.value.startsWith('-');
    let rawValue = inputElement.value.replace(/[^0-9.]/g, '');
    
    let parts = rawValue.split('.');
    if (parts.length > 2) parts = [parts[0], parts.slice(1).join('')];
    
    let intPart = parts[0];
    if (intPart) intPart = parseInt(intPart, 10).toLocaleString('en-US');
    
    let formattedValue = parts.length > 1 ? intPart + '.' + parts[1] : intPart;
    if (rawValue.endsWith('.')) formattedValue = intPart + '.';
    
    if (isNegative && formattedValue !== '') {
        formattedValue = '-' + formattedValue;
        rawValue = '-' + rawValue;
    } else if (isNegative) {
        formattedValue = '-';
        rawValue = '-';
    }

    inputElement.value = formattedValue;
    let lengthDiff = formattedValue.length - originalLength;
    cursorPosition += lengthDiff;
    if (cursorPosition < 0) cursorPosition = 0;
    inputElement.setSelectionRange(cursorPosition, cursorPosition);
    
    return isNegative && rawValue !== '-' ? '-' + rawValue.replace('-','') : rawValue;
}

function getRawNumber(val) {
    if (!val) return 0;
    const cleaned = val.toString().replace(/[^\d.-]/g, '');
    return parseFloat(cleaned) || 0;
}

function formatDateToText(dateString) {
    if (!dateString) return '';
    const [y, m, d] = dateString.split('-');
    if (!y || !m || !d) return dateString;
    const date = new Date(y, parseInt(m)-1, d);
    const options = { month: 'long', day: '2-digit', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function parseTextToDate(textString) {
    if (!textString) return '';
    const date = new Date(textString);
    if (isNaN(date)) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function switchView(viewName, element) {
    if (window.innerWidth <= 768) closeMobileSidebar();

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    
    document.getElementById('view-tracker').style.display = 'none';
    document.getElementById('view-summary').style.display = 'none';
    document.getElementById('view-payables').style.display = 'none';
    document.getElementById('view-receivables').style.display = 'none';
    document.getElementById('view-savings').style.display = 'none';
    document.getElementById('view-profile').style.display = 'none';

    if (viewName === 'tracker') {
        document.getElementById('view-tracker').style.display = 'block';
    } else if (viewName === 'summary') {
        document.getElementById('view-summary').style.display = 'block';
        renderCharts(); 
    } else if (viewName === 'payables') {
        document.getElementById('view-payables').style.display = 'block';
        renderPayables();
    } else if (viewName === 'receivables') {
        document.getElementById('view-receivables').style.display = 'block';
        renderReceivables();
    } else if (viewName === 'savings') {
        document.getElementById('view-savings').style.display = 'block';
        renderSavingsTracker();
    } else if (viewName === 'profile') {
        document.getElementById('view-profile').style.display = 'block';
        renderActivityLog();
    }
}

function onFilterChange() {
    const val = document.getElementById('periodFilter').value;
    if (window.innerWidth <= 768) {
        activeMobilePeriodIndex = val;
    } else {
        activePeriodIndex = val;
    }
    renderTable();
}

window.addEventListener('resize', () => {
    const currentlyMobile = window.innerWidth <= 768;
    if (currentlyMobile !== isMobileView) {
        isMobileView = currentlyMobile;
        const filter = document.getElementById('periodFilter');
        
        if (isMobileView) {
            if (activeMobilePeriodIndex === null || activeMobilePeriodIndex === "ALL") {
                const payoutIndex = getCurrentPayoutIndex();
                activeMobilePeriodIndex = payoutIndex !== -1 ? payoutIndex.toString() : "0";
            }
            filter.value = activeMobilePeriodIndex;
            renderTable(); 
        } else {
            activePeriodIndex = "ALL";
            filter.value = activePeriodIndex;
            renderTable();
        }
    }
});

function openClearAllModal() { document.getElementById('clearAllModal').showModal(); }
function executeClearAll(withBackup) {
    if (withBackup) { exportData(); }
    setTimeout(() => {
        appData = { categories: [ { id: 'cat_savings', name: 'Savings', goal: '', goalType: 'weekly', isDeletable: false } ], rows: [], payables: [], receivables: [], savingsAccounts: [], activityLog: [] };
        activePeriodIndex = "ALL";
        activeMobilePeriodIndex = "0";
        logActivity('Reset All Data', 'All app data was cleared.');
        fullRender();
        document.getElementById('clearAllModal').close();
        showToast('All data has been reset.', 'warning');
    }, 150);
}

function triggerImport() { document.getElementById('importFile').click(); }
function importData(e) { 
    const f=e.target.files[0]; 
    if(!f)return; 
    const r=new FileReader(); 
    r.onload=(ev)=>{ 
        try{ 
            appData=JSON.parse(ev.target.result); 
            if(!appData.activityLog) appData.activityLog = [];
            if(appData.loans) { appData.payables = appData.loans; delete appData.loans; } 
            if(!appData.payables) appData.payables = []; 
            if(!appData.receivables) appData.receivables = []; 
            if(!appData.savingsAccounts) appData.savingsAccounts = []; 
            logActivity('Imported Backup File', 'Data successfully restored from JSON.');
            fullRender(); 
            showToast('Backup restored successfully.', 'success');
        }catch(err){ 
            showToast('Invalid Backup File structure.', 'error');
        } 
        e.target.value=''; 
    }; 
    r.readAsText(f); 
}
function exportData() { 
    const b=new Blob([JSON.stringify(appData, null, 2)],{type:'application/json'});
    const u=URL.createObjectURL(b);
    const a=document.createElement('a'); 
    a.href=u; 
    a.download='FinanceTracker_Backup.json'; 
    a.click(); 
    setTimeout(() => URL.revokeObjectURL(u), 100); 
    showToast('Backup downloaded.', 'success');
}

let batchGeneratedDates = [];

function togglePayoutMode() {
    const isManual = document.querySelector('input[name="payoutAddMode"]:checked').value === 'manual';
    document.getElementById('payoutManualSection').style.display = isManual ? 'block' : 'none';
    document.getElementById('payoutBatchSection').style.display = isManual ? 'none' : 'block';
    document.getElementById('batchPreviewArea').style.display = 'none';
    document.getElementById('btnSavePayout').innerText = isManual ? 'Add Payout' : 'Save Batch Dates';
    batchGeneratedDates = [];
}

function toggleBatchOptions() {
    const freq = document.getElementById('batchFrequency').value;
    document.getElementById('batchBiWeeklyOpts').style.display = freq === 'biweekly' ? 'block' : 'none';
    document.getElementById('batchBiMonthlyOpts').style.display = freq === 'bimonthly' ? 'block' : 'none';
    document.getElementById('batchMonthlyOpts').style.display = freq === 'monthly' ? 'block' : 'none';
    document.getElementById('batchPreviewArea').style.display = 'none';
    batchGeneratedDates = [];
}

function generateBatchPreview() {
    const freq = document.getElementById('batchFrequency').value;
    batchGeneratedDates = [];

    if (freq === 'biweekly') {
        const startStr = document.getElementById('batchStartDate').value;
        const count = parseInt(document.getElementById('batchCountBiWeekly').value) || 26;
        if (!startStr) { alert("Please select a start date."); return; }
        
        let currDate = new Date(startStr);
        for(let i=0; i<count; i++) {
            batchGeneratedDates.push(new Date(currDate));
            currDate.setDate(currDate.getDate() + 14);
        }
    } else if (freq === 'bimonthly') {
        const sched = document.getElementById('batchBiMonthlySchedule').value;
        const startMonthStr = document.getElementById('batchStartMonthBi').value; 
        const months = parseInt(document.getElementById('batchMonthsBi').value) || 12;
        if (!startMonthStr) { alert("Please select a start month."); return; }

        let [yyyy, mm] = startMonthStr.split('-');
        let year = parseInt(yyyy);
        let month = parseInt(mm) - 1;
        const [day1, day2] = sched.split('-').map(Number);

        for (let i=0; i<months; i++) {
            let d1 = new Date(year, month + i, day1);
            batchGeneratedDates.push(d1);

            let d2;
            if (day2 === 30) {
                d2 = new Date(year, month + i + 1, 0);
            } else {
                d2 = new Date(year, month + i, day2);
            }
            batchGeneratedDates.push(d2);
        }
    } else if (freq === 'monthly') {
        const day = parseInt(document.getElementById('batchMonthlyDay').value) || 15;
        const startMonthStr = document.getElementById('batchStartMonthSingle').value;
        const months = parseInt(document.getElementById('batchMonthsSingle').value) || 12;
        if (!startMonthStr) { alert("Please select a start month."); return; }

        let [yyyy, mm] = startMonthStr.split('-');
        let year = parseInt(yyyy);
        let month = parseInt(mm) - 1;

        for (let i=0; i<months; i++) {
            let d = new Date(year, month + i, day);
            if (d.getMonth() !== (month + i) % 12) {
                d = new Date(year, month + i + 1, 0); 
            }
            batchGeneratedDates.push(d);
        }
    }

    const list = document.getElementById('batchPreviewList');
    list.innerHTML = '';
    batchGeneratedDates.forEach(d => {
        let li = document.createElement('li');
        li.style.padding = "0.25rem 0";
        li.style.borderBottom = "1px solid var(--border)";
        
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        
        li.innerText = formatDateToText(`${y}-${m}-${day}`);
        list.appendChild(li);
    });
    document.getElementById('batchPreviewArea').style.display = 'block';
}

function openAddPayoutModal() {
    document.getElementById('addPayoutDate').value = '';
    document.getElementById('addPayoutName').value = '';
    
    const manualRadio = document.querySelector('input[name="payoutAddMode"][value="manual"]');
    if (manualRadio) manualRadio.checked = true;
    togglePayoutMode();

    document.getElementById('addPayoutModal').showModal();
    if (document.getElementById('payoutManualSection').style.display === 'block') {
        document.getElementById('addPayoutDate').focus();
    }
}

function saveNewPayout() {
    const isManual = document.querySelector('input[name="payoutAddMode"]:checked').value === 'manual';
    
    if (isManual) {
        const rawDate = document.getElementById('addPayoutDate').value.trim();
        const d = formatDateToText(rawDate);
        const n = document.getElementById('addPayoutName').value.trim();
        if (!d) return;

        if(appData.rows.find(r => r.date === d)) {
            showToast("This payout date already exists.", "warning");
            return;
        }

        logActivity('Added Payout Period', `Date: ${d}\nName/Reason: ${n || 'None'}`);
        appData.rows.push({ date: d, name: n, isSpecial: !!n, salary: '', entries: {} });
    } else {
        if (batchGeneratedDates.length === 0) {
            showToast("Please generate a preview first.", "warning");
            return;
        }
        let addedCount = 0;
        batchGeneratedDates.forEach(d => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const textDate = formatDateToText(`${y}-${m}-${day}`);
            
            if(!appData.rows.find(r => r.date === textDate)) {
                appData.rows.push({ date: textDate, name: '', isSpecial: false, salary: '', entries: {} });
                addedCount++;
            }
        });
        
        if (addedCount === 0) {
            showToast("All generated dates already exist in your tracker.", "warning");
            return;
        }
        logActivity('Added Batch Payouts', `Generated ${addedCount} new payout periods.`);
    }

    appData.rows.sort((a, b) => new Date(a.date) - new Date(b.date));
    document.getElementById('addPayoutModal').close();
    showToast("Payout period added successfully.", "success");
    fullRender();
}

function editPayoutDate(index) {
    const row = appData.rows[index];
    document.getElementById('editPayoutIndex').value = index;
    document.getElementById('editPayoutDateInput').value = parseTextToDate(row.date);
    document.getElementById('editPayoutNameInput').value = row.name || '';
    document.getElementById('editPayoutModal').showModal();
}

function saveEditPayout() {
    const idx = document.getElementById('editPayoutIndex').value;
    const rawDate = document.getElementById('editPayoutDateInput').value.trim();
    const d = formatDateToText(rawDate);
    const n = document.getElementById('editPayoutNameInput').value.trim();
    
    if (d && appData.rows[idx]) {
        const oldDate = appData.rows[idx].date;
        logActivity('Edited Payout Period', `Old Date: ${oldDate}\nNew Date: ${d}\nReason: ${n || 'None'}`);
        
        appData.rows[idx].date = d;
        appData.rows[idx].name = n;
        appData.rows[idx].isSpecial = !!n; 
        appData.rows.sort((a, b) => new Date(a.date) - new Date(b.date));
        showToast("Payout period updated.", "success");
        fullRender();
        document.getElementById('editPayoutModal').close();
    }
}

function deletePayoutDate(index) {
    const rowDate = appData.rows[index].date;
    customConfirm("Delete this payout period? All entries for this date will be lost forever.", () => {
        logActivity('Deleted Payout Period', `Date: ${rowDate}`);
        appData.rows.splice(index, 1);
        showToast("Payout period deleted.", "error");
        fullRender();
    });
}

function openCategoryModal(catId = null) {
    document.getElementById('activeCatEditId').value = catId || '';
    const title = document.getElementById('catModalTitle');
    const nameInput = document.getElementById('catNameInput');
    const goalInput = document.getElementById('catGoalInput');
    
    let typeSelect = document.getElementById('catGoalTypeInput');
    if (!typeSelect) {
        const container = goalInput.parentElement;
        typeSelect = document.createElement('select');
        typeSelect.id = 'catGoalTypeInput';
        typeSelect.style.marginBottom = '0.5rem';
        typeSelect.style.width = '100%';
        typeSelect.style.padding = '0.65rem 1rem';
        typeSelect.style.border = '1px solid var(--border)';
        typeSelect.style.borderRadius = '8px';
        typeSelect.style.fontSize = '0.9rem';
        typeSelect.style.backgroundColor = 'var(--bg-body)';
        typeSelect.style.color = 'var(--text-main)';
        typeSelect.style.fontWeight = '500';
        typeSelect.innerHTML = `<option value="weekly">Per Payout Goal</option><option value="monthly">Monthly Goal</option>`;

        const label = document.createElement('label');
        label.style.fontSize = '0.85rem';
        label.style.fontWeight = '500';
        label.style.display = 'block';
        label.style.marginTop = '1rem';
        label.style.marginBottom = '0.25rem';
        label.innerText = 'Goal Type';

        container.parentNode.insertBefore(label, container.nextSibling);
        container.parentNode.insertBefore(typeSelect, label.nextSibling);
    }

    if (catId) {
        const cat = appData.categories.find(c => c.id === catId);
        title.innerText = "Edit Category";
        nameInput.value = cat.name;
        goalInput.value = formatForInputDisplay(cat.goal || '');
        typeSelect.value = cat.goalType || 'weekly';
    } else {
        title.innerText = "Add Category";
        nameInput.value = '';
        goalInput.value = '';
        typeSelect.value = 'weekly';
    }
    document.getElementById('categoryModal').showModal();
    nameInput.focus();
}

function saveCategory() {
    const id = document.getElementById('activeCatEditId').value;
    const name = document.getElementById('catNameInput').value.trim();
    const goalRaw = getRawNumber(document.getElementById('catGoalInput').value);
    const goal = (goalRaw === 0 && document.getElementById('catGoalInput').value === '') ? '' : goalRaw;
    
    const typeSelect = document.getElementById('catGoalTypeInput');
    const goalType = typeSelect ? typeSelect.value : 'weekly';
    
    if (!name) return;

    if (id) {
        const cat = appData.categories.find(c => c.id === id);
        logActivity('Updated Category: ' + name, `Previous Name: ${cat.name}\nPrevious Goal: ${cat.goal}\nNew Goal: ${goalRaw}\nType: ${goalType}`);
        cat.name = name;
        cat.goal = goal;
        cat.goalType = goalType;
        showToast("Category updated.", "success");
    } else {
        logActivity('Added Category: ' + name, `Goal: ${goalRaw}\nType: ${goalType}`);
        appData.categories.push({ id: generateId(), name: name, goal: goal, goalType: goalType, isDeletable: true });
        showToast("Category added successfully.", "success");
    }
    
    document.getElementById('categoryModal').close();
    fullRender();
}

function deleteCategory(id) {
    const catName = appData.categories.find(c => c.id === id)?.name || 'Unknown';
    customConfirm("Delete this category completely? All amounts and notes will be lost forever.", () => {
        logActivity('Deleted Category: ' + catName, 'Removed category and all associated entries.');
        appData.categories = appData.categories.filter(c => c.id !== id);
        appData.rows.forEach(row => delete row.entries[id]); 
        showToast("Category deleted.", "error");
        fullRender();
    });
}

function updatePeriodFilterOptions() {
    const select = document.getElementById('periodFilter');
    const isMobile = window.innerWidth <= 768;
    
    let lastSalaryIndex = -1;
    appData.rows.forEach((r, idx) => {
        if (r.salary && parseFloat(r.salary) > 0) lastSalaryIndex = idx;
    });
    
    let maxIndex = lastSalaryIndex + 1;
    if (maxIndex >= appData.rows.length) maxIndex = appData.rows.length - 1;
    if (maxIndex < 0) maxIndex = 0;

    let html = '';
    if (!isMobile) { html += `<option value="ALL">View All Periods</option>`; }
    
    for (let i = 0; i <= maxIndex; i++) {
        const r = appData.rows[i];
        if (r) {
            const displayName = r.isSpecial && r.name ? `${r.date} - ${r.name}` : r.date;
            html += `<option value="${i}">${displayName}</option>`;
        }
    }
    
    select.innerHTML = html;
    
    if (activeMobilePeriodIndex === null || activeMobilePeriodIndex === "ALL") {
        const payoutIndex = getCurrentPayoutIndex();
        activeMobilePeriodIndex = payoutIndex !== -1 ? payoutIndex.toString() : "0";
    }
    
    if (isMobile) { 
        if (parseInt(activeMobilePeriodIndex) > maxIndex) activeMobilePeriodIndex = maxIndex.toString();
        select.value = activeMobilePeriodIndex; 
    } else { 
        if (activePeriodIndex === null || activePeriodIndex === "ALL" || parseInt(activePeriodIndex) > maxIndex) activePeriodIndex = "ALL";
        select.value = activePeriodIndex; 
    }
}

function getDeficitsUpTo(rows, categories) {
    let deficits = {};
    let monthlyPaid = {};

    categories.forEach(c => {
        deficits[c.id] = { amount: 0, fromDate: '' };
        monthlyPaid[c.id] = 0;
    });

    let rowDeficits = [];
    let previousMonth = -1;
    let previousYear = -1;
    
    rows.forEach(row => {
        const currentDate = new Date(row.date);
        const currentMonth = currentDate.getMonth();
        const currentYear = currentDate.getFullYear();

        if (previousMonth !== -1 && (currentMonth !== previousMonth || currentYear !== previousYear)) {
            categories.forEach(c => {
                deficits[c.id] = { amount: 0, fromDate: '' };
                monthlyPaid[c.id] = 0;
            });
        }

        let currentDeficits = JSON.parse(JSON.stringify(deficits)); 
        let currentMonthlyPaid = JSON.parse(JSON.stringify(monthlyPaid));

        rowDeficits.push({
            weekly: currentDeficits,
            monthlyPaid: currentMonthlyPaid
        });
        
        categories.forEach(cat => {
            const entry = row.entries[cat.id];
            const goal = getRawNumber(cat.goal);
            const isMonthly = cat.goalType === 'monthly';

            const paid = (entry && (entry.status === 'Carry Over' || entry.status === 'Done/Paid')) ? getRawNumber(entry.amount) : 0;
            monthlyPaid[cat.id] += paid;
            
            if (!isMonthly) {
                if (goal > 0 && entry && (entry.status === 'Carry Over' || entry.status === 'Done/Paid')) {
                    const expected = goal + currentDeficits[cat.id].amount;
                    const shortfall = expected - paid;
                    
                    if (shortfall !== 0) {
                        deficits[cat.id] = { amount: shortfall, fromDate: row.date };
                    } else {
                        deficits[cat.id] = { amount: 0, fromDate: '' };
                    }
                } else {
                    deficits[cat.id] = { amount: 0, fromDate: '' };
                }
            }
        });

        previousMonth = currentMonth;
        previousYear = currentYear;
    });
    return rowDeficits;
}

function getStatusClass(status) {
    if (status === 'Done/Paid') return 'status-paid';
    if (status === 'Not Required Yet') return 'status-notreq';
    if (status === 'Carry Over') return 'status-carry';
    return 'status-empty';
}

function checkBudgetWarning(rowObj) {
    let totalDeductions = 0;
    appData.categories.forEach(cat => {
        if (rowObj.entries[cat.id]) {
            totalDeductions += parseFloat(rowObj.entries[cat.id].amount) || 0;
        }
    });
    const sal = parseFloat(rowObj.salary) || 0;
    if (sal > 0 && sal - totalDeductions < 0) {
        if (!rowObj._warnedBudget) {
            showToast("Budget Alert: You are over budget for this period!", "warning");
            rowObj._warnedBudget = true;
        }
    } else {
        rowObj._warnedBudget = false;
    }
}

function renderTable() {
    updatePeriodFilterOptions();
    const filterVal = document.getElementById('periodFilter').value;
    
    if (!appData.rows || appData.rows.length === 0) {
        document.getElementById('trackerEmptyState').style.display = 'block';
        document.querySelector('.table-container').style.display = 'none';
        document.getElementById('mobileTrackerView').style.display = 'none';
        const controlFilter = document.querySelector('.controls .filter-row');
        if(controlFilter) controlFilter.style.visibility = 'hidden';
    } else {
        document.getElementById('trackerEmptyState').style.display = 'none';
        
        document.querySelector('.table-container').style.display = '';
        document.getElementById('mobileTrackerView').style.display = '';
        
        const controlFilter = document.querySelector('.controls .filter-row');
        if(controlFilter) controlFilter.style.visibility = 'visible';
        
        renderDesktopTable(filterVal);
        renderMobileView(filterVal);
    }
}

function renderDesktopTable(filterVal) {
    const headRow = document.getElementById('tableHeadRow');
    const body = document.getElementById('tableBody');
    const rowDeficits = getDeficitsUpTo(appData.rows, appData.categories);
    const payoutIndex = getCurrentPayoutIndex();
    
    let headHTML = `<th style="width: 320px;">Period Details</th>`;
    appData.categories.forEach(cat => {
        let goalText = cat.goal ? `<br><span style="font-size:0.75rem; color:var(--text-muted); font-weight: 400;">Goal: ${formatPHP(cat.goal)} ${cat.goalType === 'monthly' ? '(Monthly)' : ''}</span>` : '';
        headHTML += `<th><div class="cat-header"><div><span title="${cat.name}">${cat.name}</span>${goalText}</div><div class="actions-group"><button class="btn-icon" onclick="openCategoryModal('${cat.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>${cat.isDeletable ? `<button class="btn-icon" style="border:none" onclick="deleteCategory('${cat.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}</div></div></th>`;
    });
    headRow.innerHTML = headHTML;

    let bodyHTML = '';
    appData.rows.forEach((row, originalIndex) => {
        if (filterVal !== "ALL" && filterVal !== originalIndex.toString()) return;
        
        let isCurrent = originalIndex === payoutIndex;
        let isSubsequentCutoffInMonth = false;
        
        let firstRowOfMonthIndex = originalIndex;
        while (firstRowOfMonthIndex > 0) {
            const currDate = new Date(appData.rows[firstRowOfMonthIndex].date);
            const prevDate = new Date(appData.rows[firstRowOfMonthIndex - 1].date);
            if (currDate.getMonth() === prevDate.getMonth() && currDate.getFullYear() === prevDate.getFullYear()) {
                firstRowOfMonthIndex--;
                isSubsequentCutoffInMonth = true;
            } else {
                break;
            }
        }
        
        const firstRowOfMonth = appData.rows[firstRowOfMonthIndex];
        const firstRowSalary = parseFloat(firstRowOfMonth.salary) || 0;

        let totalDeductions = 0;
        const salaryNum = parseFloat(row.salary) || 0;
        let missingCats = [];

        appData.categories.forEach(cat => { 
            const entry = row.entries[cat.id];
            let isMissing = false;

            if (entry) {
                const amt = parseFloat(entry.amount) || 0;
                totalDeductions += amt; 
                if(!entry.status || entry.status === '') isMissing = true;
            } else {
                isMissing = true;
            }

            if (isMissing && cat.goalType === 'monthly') {
                const goal = getRawNumber(cat.goal);
                const paidSoFar = rowDeficits[originalIndex].monthlyPaid[cat.id] || 0;
                if (goal > 0 && paidSoFar >= goal) {
                    isMissing = false;
                }
            }

            if (isMissing) {
                missingCats.push(cat.name);
            }
        });

        const remaining = salaryNum - totalDeductions;
        const isOverBudget = remaining < 0;

        let pendingHTML = '';
        if (missingCats.length > 0) {
            let chips = missingCats.map(catName => `<span class="pending-chip">${catName}</span>`).join('');
            pendingHTML = `<div class="pending-container"><span class="pending-label">Pending</span><div class="pending-chips">${chips}</div></div>`;
        }

        let dateLabelHtml = `<div style="font-weight:600; font-size:1.1rem; display:flex; align-items:flex-start; justify-content:space-between;"><div>${row.date}${row.isSpecial && row.name ? `<div style="font-size:0.75rem; color: var(--primary); margin-top:0.25rem;">✨ ${row.name}</div>` : ''}</div><div class="actions-group" style="gap:0.2rem;"><button class="btn-icon" style="padding: 0.2rem;" onclick="editPayoutDate(${originalIndex})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button><button class="btn-icon" style="padding: 0.2rem; color: var(--danger);" onclick="deletePayoutDate(${originalIndex})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></div>`;

        let frozenColumnHTML = `
            <td class="${isOverBudget ? 'over-budget' : ''}">
                <div style="margin-bottom: 1rem;">
                    ${dateLabelHtml}
                    <div>${isOverBudget ? `<div class="warning-badge">⚠️ Over Budget</div>` : ``}</div>
                </div>
                <label style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Salary Received</label>
                <div class="currency-input" style="margin-bottom: 1rem;">
                    <span>₱</span><input type="text" id="salary_input_${originalIndex}" inputmode="decimal" value="${formatForInputDisplay(row.salary)}" oninput="handleSalaryInput(this, ${originalIndex})" placeholder="0.00">
                </div>
                <div class="remaining-wrapper">
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500; text-transform: uppercase;">Remaining</div>
                    <div class="remaining-val" style="color: ${isOverBudget ? 'var(--danger)' : 'var(--primary)'}">${formatPHP(remaining)}</div>
                    ${pendingHTML}
                </div>
            </td>
        `;

        let categoriesHTML = '';
        appData.categories.forEach(cat => {
            const entry = row.entries[cat.id] || { amount: '', status: '', comments: [] };
            let commentsHTML = entry.comments?.length > 0 ? `<div class="comments-list">${entry.comments.map((c, i) => `<div class="comment-item"><span class="comment-title" onclick="openCommentModal(${originalIndex}, '${cat.id}', ${i})" title="${c.title}">📄 ${c.title}</span><button class="comment-delete" onclick="deleteComment(${originalIndex}, '${cat.id}', ${i}, event)">✕</button></div>`).join('')}</div>` : '';
            
            let carryOverIndicator = '';
            const isMonthly = cat.goalType === 'monthly';

            if (isMonthly) {
                const goal = getRawNumber(cat.goal);
                
                const firstRowEntryStatus = (firstRowOfMonth.entries[cat.id] && firstRowOfMonth.entries[cat.id].status) ? firstRowOfMonth.entries[cat.id].status : '';
                const isFirstRowProcessed = (firstRowSalary > 0 && firstRowEntryStatus && firstRowEntryStatus !== '');

                if (goal > 0 && isSubsequentCutoffInMonth && isFirstRowProcessed) {
                    const paidSoFar = rowDeficits[originalIndex].monthlyPaid[cat.id];
                    const remainingForMonth = goal - paidSoFar;

                    if (remainingForMonth > 0) {
                        carryOverIndicator = `<div class="carry-over-indicator" style="margin-top:0.5rem; margin-bottom:0;">Please provide ${formatPHP(remainingForMonth)} for this cutoff</div>`;
                    } else if (remainingForMonth < 0) {
                        carryOverIndicator = `<div class="overpayment-indicator" style="margin-top:0.5rem; margin-bottom:0;">Monthly goal exceeded by ${formatPHP(Math.abs(remainingForMonth))}</div>`;
                    }
                }
            } else {
                let defVal = rowDeficits[originalIndex].weekly[cat.id].amount || 0;
                let defDate = rowDeficits[originalIndex].weekly[cat.id].fromDate || '';

                if (defVal > 0) {
                    carryOverIndicator = `<div class="carry-over-indicator" style="margin-top:0.5rem; margin-bottom:0;">+ ${formatPHP(defVal)} Carry Over from ${defDate}</div>`;
                } else if (defVal < 0) {
                    carryOverIndicator = `<div class="overpayment-indicator" style="margin-top:0.5rem; margin-bottom:0;">- ${formatPHP(Math.abs(defVal))} Overpayment from ${defDate}</div>`;
                }
            }
            
            categoriesHTML += `
                <td>
                    <div class="master-cell-wrapper">
                        <div class="currency-input"><span>₱</span><input type="text" id="entry_input_${originalIndex}_${cat.id}" inputmode="decimal" value="${formatForInputDisplay(entry.amount)}" oninput="handleEntryInput(this, ${originalIndex}, '${cat.id}')" placeholder="0.00"></div>
                        <select class="${getStatusClass(entry.status)}" onchange="handleStatusChange(${originalIndex}, '${cat.id}', this.value)">
                            <option value="" ${!entry.status || entry.status === '' ? 'selected' : ''}>Status...</option>
                            <option value="Done/Paid" ${entry.status === 'Done/Paid' ? 'selected' : ''}>Done/Paid</option>
                            <option value="Not Required Yet" ${entry.status === 'Not Required Yet' ? 'selected' : ''}>Not Required Yet</option>
                            <option value="Carry Over" ${entry.status === 'Carry Over' ? 'selected' : ''}>Carry Over</option>
                        </select>
                        ${carryOverIndicator}
                        ${commentsHTML}
                        <button class="btn-small" style="margin-top:0.5rem;" onclick="openCommentModal(${originalIndex}, '${cat.id}')">+ Add Note</button>
                    </div>
                </td>
            `;
        });

        bodyHTML += `<tr class="${isCurrent ? 'highlight-row' : ''}">${frozenColumnHTML}${categoriesHTML}</tr>`;
    });
    body.innerHTML = bodyHTML;
}

function renderMobileView(filterVal) {
    const container = document.getElementById('mobileTrackerView');
    if (filterVal === "ALL") { container.innerHTML = ''; return; } 

    const rowIndex = parseInt(filterVal);
    const row = appData.rows[rowIndex];
    if(!row) return;
    
    const payoutIndex = getCurrentPayoutIndex();
    const isCurrent = rowIndex === payoutIndex;
    const rowDeficits = getDeficitsUpTo(appData.rows, appData.categories);

    let isSubsequentCutoffInMonth = false;
    let firstRowOfMonthIndex = rowIndex;
    while (firstRowOfMonthIndex > 0) {
        const currDate = new Date(appData.rows[firstRowOfMonthIndex].date);
        const prevDate = new Date(appData.rows[firstRowOfMonthIndex - 1].date);
        if (currDate.getMonth() === prevDate.getMonth() && currDate.getFullYear() === prevDate.getFullYear()) {
            firstRowOfMonthIndex--;
            isSubsequentCutoffInMonth = true;
        } else {
            break;
        }
    }
    
    const firstRowOfMonth = appData.rows[firstRowOfMonthIndex];
    const firstRowSalary = parseFloat(firstRowOfMonth.salary) || 0;

    let totalDeductions = 0;
    let missingCats = [];
    appData.categories.forEach(cat => { 
        const entry = row.entries[cat.id];
        let isMissing = false;

        if (entry) {
            const amt = parseFloat(entry.amount) || 0;
            totalDeductions += amt; 
            if(!entry.status || entry.status === '') isMissing = true;
        } else {
            isMissing = true;
        }

        if (isMissing && cat.goalType === 'monthly') {
            const goal = getRawNumber(cat.goal);
            const paidSoFar = rowDeficits[rowIndex].monthlyPaid[cat.id] || 0;
            if (goal > 0 && paidSoFar >= goal) {
                isMissing = false;
            }
        }

        if (isMissing) {
            missingCats.push(cat.name);
        }
    });

    const salaryNum = parseFloat(row.salary) || 0;
    const remaining = salaryNum - totalDeductions;
    const isOverBudget = remaining < 0;

    let pendingHTML = '';
    if (missingCats.length > 0) {
        let chips = missingCats.map(catName => `<span class="pending-chip">${catName}</span>`).join('');
        pendingHTML = `<div class="pending-container"><span class="pending-label">Pending</span><div class="pending-chips">${chips}</div></div>`;
    }

    let dateLabelHtml = `<div style="font-weight:600; font-size:1.25rem; display:flex; align-items:flex-start; justify-content:space-between;"><div>${row.date}${row.isSpecial && row.name ? `<div style="font-size:0.9rem; color: var(--primary); margin-top:0.25rem;">✨ ${row.name}</div>` : ''}</div><div class="actions-group" style="gap:0.2rem;"><button class="btn-icon" style="padding: 0.2rem;" onclick="editPayoutDate(${rowIndex})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button><button class="btn-icon" style="padding: 0.2rem; color: var(--danger);" onclick="deletePayoutDate(${rowIndex})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></div>`;

    let html = `
        <div class="mobile-sticky-header-wrapper">
            <div class="card mobile-sticky-card ${isCurrent ? 'highlight-row' : ''}" id="mobile_sticky_card_${rowIndex}" style="border-left: 4px solid ${isOverBudget ? 'var(--danger)' : 'var(--primary)'}; padding: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                    <div style="flex:1;">
                        ${dateLabelHtml}
                        <div>${isOverBudget ? `<div class="warning-badge" style="margin-top: 0;">⚠️ Over Budget</div>` : ''}</div>
                    </div>
                    <div style="text-align: right; margin-left:1rem;">
                        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Remaining</div>
                        <div style="font-size: 1.5rem; font-weight: 700; color: ${isOverBudget ? 'var(--danger)' : 'var(--primary)'};">${formatPHP(remaining)}</div>
                    </div>
                </div>
                <label style="font-size: 0.85rem; font-weight: 500; color: var(--text-muted);">Salary Received</label>
                <div class="currency-input" style="margin-top: 0.25rem; margin-bottom: 0;">
                    <span>₱</span>
                    <input type="text" id="mobile_salary_input_${rowIndex}" inputmode="decimal" value="${formatForInputDisplay(row.salary)}" oninput="handleSalaryInput(this, ${rowIndex})" placeholder="0.00" style="margin-bottom: 0;">
                </div>
                ${pendingHTML}
            </div>
        </div>
    `;

    appData.categories.forEach(cat => {
        const entry = row.entries[cat.id] || { amount: '', status: '', comments: [] };
        let commentsHTML = entry.comments?.length > 0 ? `<div class="comments-list">${entry.comments.map((c, i) => `<div class="comment-item"><span class="comment-title" onclick="openCommentModal(${rowIndex}, '${cat.id}', ${i})" title="${c.title}">📄 ${c.title}</span><button class="comment-delete" onclick="deleteComment(${rowIndex}, '${cat.id}', ${i}, event)">✕</button></div>`).join('')}</div>` : '';
        
        let carryOverIndicator = '';
        const isMonthly = cat.goalType === 'monthly';

        if (isMonthly) {
            const goal = getRawNumber(cat.goal);
            
            const firstRowEntryStatus = (firstRowOfMonth.entries[cat.id] && firstRowOfMonth.entries[cat.id].status) ? firstRowOfMonth.entries[cat.id].status : '';
            const isFirstRowProcessed = (firstRowSalary > 0 && firstRowEntryStatus && firstRowEntryStatus !== '');

            if (goal > 0 && isSubsequentCutoffInMonth && isFirstRowProcessed) {
                const paidSoFar = rowDeficits[rowIndex].monthlyPaid[cat.id];
                const remainingForMonth = goal - paidSoFar;

                if (remainingForMonth > 0) {
                    carryOverIndicator = `<div class="carry-over-indicator" style="margin-top:0.5rem; margin-bottom:0;">Please provide ${formatPHP(remainingForMonth)} for this cutoff</div>`;
                } else if (remainingForMonth < 0) {
                    carryOverIndicator = `<div class="overpayment-indicator" style="margin-top:0.5rem; margin-bottom:0;">Monthly goal exceeded by ${formatPHP(Math.abs(remainingForMonth))}</div>`;
                }
            }
        } else {
            let defVal = rowDeficits[rowIndex].weekly[cat.id].amount || 0;
            let defDate = rowDeficits[rowIndex].weekly[cat.id].fromDate || '';

            if (defVal > 0) {
                carryOverIndicator = `<div class="carry-over-indicator" style="margin-top:0.5rem; margin-bottom:0;">+ ${formatPHP(defVal)} Carry Over from ${defDate}</div>`;
            } else if (defVal < 0) {
                carryOverIndicator = `<div class="overpayment-indicator" style="margin-top:0.5rem; margin-bottom:0;">- ${formatPHP(Math.abs(defVal))} Overpayment from ${defDate}</div>`;
            }
        }
        
        html += `
            <div class="card ${isCurrent ? 'highlight-row' : ''}" style="margin-bottom: 1rem; padding: 1.25rem;">
                <div style="font-weight: 600; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        ${cat.name}
                        ${cat.goal ? `<div style="font-size:0.75rem; color:var(--text-muted); font-weight: 400; margin-top: 0.2rem;">Goal: ${formatPHP(cat.goal)} ${cat.goalType === 'monthly' ? '(Monthly)' : ''}</div>` : ''}
                    </div>
                    <div class="actions-group">
                        <button class="btn-icon" onclick="openCategoryModal('${cat.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                        ${cat.isDeletable ? `<button class="btn-icon" style="color: var(--text-muted);" onclick="deleteCategory('${cat.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
                    </div>
                </div>
                <div class="currency-input">
                    <span>₱</span>
                    <input type="text" id="mobile_entry_input_${rowIndex}_${cat.id}" inputmode="decimal" value="${formatForInputDisplay(entry.amount)}" oninput="handleEntryInput(this, ${rowIndex}, '${cat.id}')" placeholder="0.00">
                </div>
                <select class="${getStatusClass(entry.status)}" onchange="handleStatusChange(${rowIndex}, '${cat.id}', this.value)" style="margin-bottom: 0;">
                    <option value="" ${!entry.status || entry.status === '' ? 'selected' : ''}>Status...</option>
                    <option value="Done/Paid" ${entry.status === 'Done/Paid' ? 'selected' : ''}>Done/Paid</option>
                    <option value="Not Required Yet" ${entry.status === 'Not Required Yet' ? 'selected' : ''}>Not Required Yet</option>
                    <option value="Carry Over" ${entry.status === 'Carry Over' ? 'selected' : ''}>Carry Over</option>
                </select>
                ${carryOverIndicator}
                ${commentsHTML}
                <button class="btn-small" onclick="openCommentModal(${rowIndex}, '${cat.id}')" style="margin-top: 0.5rem;">+ Add Note</button>
            </div>
        `;
    });

    container.innerHTML = html;
}

function handleSalaryInput(e, r) { 
    const oldValRaw = appData.rows[r].salary || '';
    const oldValClean = formatForInputDisplay(getRawNumber(oldValRaw));

    appData.rows[r].salary = formatInputInPlace(e); 
    
    const newValClean = formatForInputDisplay(getRawNumber(appData.rows[r].salary));

    if (oldValClean !== newValClean) {
        const timerKey = `salary_${r}`;
        const originalOldVal = logDebounceTimers[timerKey] ? logDebounceTimers[timerKey].oldVal : oldValClean;

        if (logDebounceTimers[timerKey]) clearTimeout(logDebounceTimers[timerKey].timer);

        logDebounceTimers[timerKey] = {
            oldVal: originalOldVal,
            timer: setTimeout(() => {
                const finalValClean = formatForInputDisplay(getRawNumber(appData.rows[r].salary));
                if (originalOldVal !== finalValClean) {
                    logActivity('Updated Salary Received', `Period: ${appData.rows[r].date}\nChanged from ₱${originalOldVal || '0'} to ₱${finalValClean || '0'}`);
                }
                delete logDebounceTimers[timerKey];
            }, 2000)
        };
    }

    checkBudgetWarning(appData.rows[r]);
    fullRender(true); 
}

function handleEntryInput(e, r, c) { 
    if (!appData.rows[r].entries[c]) appData.rows[r].entries[c] = { amount: '', status: '', comments: [] }; 
    
    const oldValRaw = appData.rows[r].entries[c].amount;
    const oldValClean = formatForInputDisplay(getRawNumber(oldValRaw));

    appData.rows[r].entries[c].amount = formatInputInPlace(e); 

    const newValClean = formatForInputDisplay(getRawNumber(appData.rows[r].entries[c].amount));

    if (oldValClean !== newValClean) {
        const timerKey = `entry_${r}_${c}`;
        const originalOldVal = logDebounceTimers[timerKey] ? logDebounceTimers[timerKey].oldVal : oldValClean;

        if (logDebounceTimers[timerKey]) clearTimeout(logDebounceTimers[timerKey].timer);

        logDebounceTimers[timerKey] = {
            oldVal: originalOldVal,
            timer: setTimeout(() => {
                const finalValClean = formatForInputDisplay(getRawNumber(appData.rows[r].entries[c].amount));
                if (originalOldVal !== finalValClean) {
                    const cat = appData.categories.find(x => x.id === c);
                    logActivity('Updated Allocation Amount', `Period: ${appData.rows[r].date}\nCategory: ${cat ? cat.name : 'Unknown'}\nChanged from ₱${originalOldVal || '0'} to ₱${finalValClean || '0'}`);
                }
                delete logDebounceTimers[timerKey];
            }, 2000)
        };
    }

    checkBudgetWarning(appData.rows[r]);
    fullRender(true); 
}

function handleStatusChange(r, c, v) { 
    if (!appData.rows[r].entries[c]) appData.rows[r].entries[c] = { amount: '', status: '', comments: [] }; 
    appData.rows[r].entries[c].status = v; 
    
    const cat = appData.categories.find(x => x.id === c);
    if (cat) {
        logActivity('Updated Status', `Period: ${appData.rows[r].date}\nCategory: ${cat.name}\nStatus changed to: ${v || 'None'}`);
    }
    
    fullRender(false); 
    if (v === 'Done/Paid') showToast('Marked as Done/Paid.', 'success');
}

function openCommentModal(r, c, i = -1) { 
    document.getElementById('activeRowIndex').value=r; 
    document.getElementById('activeCatId').value=c; 
    document.getElementById('activeCommentIndex').value=i; 
    
    const t=document.getElementById('commentTitleInput'); 
    
    if(i>=0){
        t.value=appData.rows[r].entries[c].comments[i].title; 
        quillEditor.root.innerHTML = appData.rows[r].entries[c].comments[i].body;
    }else{
        t.value=''; 
        quillEditor.root.innerHTML = '';
    } 
    document.getElementById('commentModal').showModal(); 
}

function closeCommentModal() { document.getElementById('commentModal').close(); }

function saveComment() { 
    const r=document.getElementById('activeRowIndex').value; 
    const c=document.getElementById('activeCatId').value; 
    const i=parseInt(document.getElementById('activeCommentIndex').value); 
    
    let t = document.getElementById('commentTitleInput').value.trim(); 
    if(!t) {
        const today = new Date();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const yyyy = today.getFullYear();
        t = 'Note: ' + mm + '/' + dd + '/' + yyyy;
    }
    
    const b = quillEditor.root.innerHTML.trim(); 
    const textContent = quillEditor.getText().trim();
    if(textContent.length === 0 && !b.includes('<img')) return; // Ignore completely empty submits
    
    if(!appData.rows[r].entries[c]) appData.rows[r].entries[c]={amount:'',status:'',comments:[]}; 
    if(!appData.rows[r].entries[c].comments) appData.rows[r].entries[c].comments=[]; 
    
    if(i>=0) appData.rows[r].entries[c].comments[i]={title:t,body:b}; 
    else appData.rows[r].entries[c].comments.push({title:t,body:b}); 
    
    const cat = appData.categories.find(x => x.id === c);
    logActivity(i >= 0 ? 'Edited Note' : 'Added Note', `Period: ${appData.rows[r].date}\nCategory: ${cat.name}\nNote Title: ${t}`);
    
    saveData(true); 
    closeCommentModal(); 
    showToast('Note added.', 'success');
    fullRender(); 
}

function deleteComment(r, c, i, e) { 
    e.stopPropagation(); 
    const cat = appData.categories.find(x => x.id === c);
    customConfirm("Delete this note?", () => {
        logActivity('Deleted Note', `Period: ${appData.rows[r].date}\nCategory: ${cat.name}`);
        appData.rows[r].entries[c].comments.splice(i, 1); 
        saveData(true); 
        showToast('Note deleted.', 'error');
        fullRender();
    });
}

function computeAmortization() {
    const totalRaw = getRawNumber(document.getElementById('payableTotalInput').value);
    const months = parseInt(document.getElementById('payableMonthsInput').value) || 0;

    if (totalRaw > 0 && months > 0) {
        const amort = totalRaw / months;
        const amortInput = document.getElementById('payableAmortInput');
        amortInput.value = formatForInputDisplay(amort.toFixed(2));
    } else {
        document.getElementById('payableAmortInput').value = '';
    }
}

function openPayableSetupModal() {
    document.getElementById('payableNameInput').value = '';
    document.getElementById('payableTotalInput').value = '';
    document.getElementById('payableMonthsInput').value = '';
    document.getElementById('payableAmortInput').value = '';
    document.getElementById('payableSetupModal').showModal();
}

function savePayable() {
    const name = document.getElementById('payableNameInput').value.trim();
    const totalRaw = getRawNumber(document.getElementById('payableTotalInput').value);
    const months = parseInt(document.getElementById('payableMonthsInput').value) || 0;
    const amortRaw = getRawNumber(document.getElementById('payableAmortInput').value);
    
    if (!name || totalRaw <= 0) return;

    logActivity('Added Payable', `Name: ${name}\nTotal: ${formatPHP(totalRaw)}\nMonths: ${months}\nAmortization: ${formatPHP(amortRaw)}`);
    
    appData.payables.push({
        id: generateId(),
        name: name,
        totalAmount: totalRaw,
        months: months,
        amortization: amortRaw,
        payments: []
    });
    
    document.getElementById('payableSetupModal').close();
    showToast('Payable added.', 'success');
    fullRender();
}

function deletePayable(id) {
    const payable = appData.payables.find(p => p.id === id);
    customConfirm("Delete this payable and all its payment history?", () => {
        logActivity('Deleted Payable', `Name: ${payable.name}`);
        appData.payables = appData.payables.filter(p => p.id !== id);
        showToast('Payable deleted.', 'error');
        fullRender();
    });
}

function openPayablePaymentModal(payableId) {
    document.getElementById('activePayablePaymentId').value = payableId;
    document.getElementById('payablePaymentAmountInput').value = '';
    document.getElementById('payablePaymentDateInput').value = new Date().toISOString().split('T')[0];
    document.getElementById('payablePaymentModal').showModal();
}

function savePayablePayment() {
    const payableId = document.getElementById('activePayablePaymentId').value;
    const amountRaw = getRawNumber(document.getElementById('payablePaymentAmountInput').value);
    const date = document.getElementById('payablePaymentDateInput').value;

    if (amountRaw <= 0 || !date) return;

    const payable = appData.payables.find(p => p.id === payableId);
    logActivity('Logged Payable Payment', `Payable: ${payable.name}\nAmount: ${formatPHP(amountRaw)}\nDate: ${date}`);
    payable.payments.push({ id: generateId(), amount: amountRaw, date: date });
    
    payable.payments.sort((a,b) => new Date(b.date) - new Date(a.date));

    document.getElementById('payablePaymentModal').close();
    showToast('Payment logged.', 'success');
    fullRender();
}

function deletePayablePayment(payableId, paymentId) {
    const payable = appData.payables.find(p => p.id === payableId);
    customConfirm("Delete this payment record?", () => {
        logActivity('Deleted Payable Payment', `Payable: ${payable.name}`);
        payable.payments = payable.payments.filter(p => p.id !== paymentId);
        showToast('Payment deleted.', 'error');
        fullRender();
    });
}

function renderPayables() {
    const container = document.getElementById('payablesContainer');
    const emptyState = document.getElementById('payablesEmptyState');

    if (!appData.payables || appData.payables.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    let html = '';

    appData.payables.forEach(payable => {
        let totalPaid = 0;
        let paidCount = 0;
        let visiblePaymentsHtml = '';
        let hiddenPaymentsHtml = '';
        
        let sortedPayments = [...payable.payments].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        payable.payments.forEach(p => {
            totalPaid += p.amount;
            if (p.amount >= payable.amortization && payable.amortization > 0) {
                paidCount++;
            }
        });

        sortedPayments.forEach((p, idx) => {
            const itemHtml = `
                <div class="comment-item" style="margin-bottom: 0.25rem; font-size: 0.75rem;">
                    <span style="color: var(--text-muted); width: 80px;">${p.date}</span>
                    <span style="font-weight: 600; flex-grow: 1; text-align: right; padding-right: 1rem;">${formatPHP(p.amount)}</span>
                    <button class="comment-delete" onclick="deletePayablePayment('${payable.id}', '${p.id}')">✕</button>
                </div>
            `;
            
            if (idx < 3) visiblePaymentsHtml += itemHtml;
            else hiddenPaymentsHtml += itemHtml;
        });

        let finalPaymentsHtml = visiblePaymentsHtml;
        if (hiddenPaymentsHtml) {
            finalPaymentsHtml += `<div id="hidden_pay_${payable.id}" style="display:none;">${hiddenPaymentsHtml}</div>`;
            finalPaymentsHtml += `<button class="btn-small" onclick="toggleEntries('hidden_pay_${payable.id}', this)">Show More History</button>`;
        }

        const remaining = payable.totalAmount - totalPaid;
        const isFullyPaid = remaining <= 0;

        html += `
            <div class="card" style="border-left: 4px solid ${isFullyPaid ? 'var(--positive)' : 'var(--primary)'}; opacity: ${isFullyPaid ? '0.7' : '1'};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                    <div>
                        <h3 style="margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem;">
                            ${payable.name} ${isFullyPaid ? '<span class="status-paid" style="font-size:0.6rem; padding:0.1rem 0.4rem; border-radius:4px;">FULLY PAID</span>' : ''}
                        </h3>
                        <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
                            Amortization:<br>
                            <span style="color: var(--text-main); font-weight: 500;">${formatPHP(payable.amortization)} / mo for ${payable.months} months</span><br>
                            Paid ${paidCount} out of ${payable.months}
                        </div>
                    </div>
                    <div class="actions-group">
                        <button class="btn-icon" style="color: var(--danger);" onclick="deletePayable('${payable.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                    </div>
                </div>
                <div style="margin-bottom: 1rem;">
                    <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Remaining Balance</div>
                    <div class="value" style="color: ${isFullyPaid ? 'var(--positive)' : 'var(--primary)'}; word-break: break-word; overflow-wrap: break-word; font-size: clamp(1.5rem, 5vw, 2.25rem);">${formatPHP(Math.max(0, remaining))}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">out of ${formatPHP(payable.totalAmount)} total</div>
                </div>
                <div style="border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem;">
                    <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
                        Payment History
                        <span style="color: var(--positive); font-weight: 500;">Total Paid: ${formatPHP(totalPaid)}</span>
                    </div>
                    <div class="comments-list" style="margin-bottom: 1rem; max-height: none; overflow-y: visible;">
                        ${finalPaymentsHtml || '<div style="font-size:0.75rem; color: var(--text-muted); text-align: center; padding: 1rem 0;">No payments logged yet.</div>'}
                    </div>
                    ${!isFullyPaid ? `<button class="btn-secondary" style="width: 100%; justify-content: center; background: transparent;" onclick="openPayablePaymentModal('${payable.id}')">+ Log Payment</button>` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function openReceivableSetupModal() {
    document.getElementById('receivableNameInput').value = '';
    document.getElementById('receivableSetupModal').showModal();
}

function saveReceivable() {
    const name = document.getElementById('receivableNameInput').value.trim();
    if(!name) return;

    logActivity('Added Receivable', `Name: ${name}`);
    appData.receivables.push({ id: generateId(), name: name, entries: [], payments: [] });
    document.getElementById('receivableSetupModal').close();
    showToast('Receivable added.', 'success');
    fullRender();
}

function deleteReceivable(id) {
    const rec = appData.receivables.find(r => r.id === id);
    customConfirm("Delete this receivable and all its entries?", () => {
        logActivity('Deleted Receivable', `Name: ${rec.name}`);
        appData.receivables = appData.receivables.filter(r => r.id !== id);
        showToast('Receivable deleted.', 'error');
        fullRender();
    });
}

function openReceivableEntryModal(recId, entryId = null) {
    document.getElementById('activeReceivableId').value = recId;
    document.getElementById('activeRecEntryRecordId').value = entryId || '';
    
    if (entryId) {
        const rec = appData.receivables.find(r => r.id === recId);
        const entry = rec.entries.find(e => e.id === entryId);
        document.getElementById('receivableEntryDescInput').value = entry.description;
        document.getElementById('receivableEntryAmountInput').value = formatForInputDisplay(Math.abs(entry.amount));
        document.getElementById('receivableEntryDateInput').value = entry.date;
    } else {
        document.getElementById('receivableEntryDescInput').value = '';
        document.getElementById('receivableEntryAmountInput').value = '';
        document.getElementById('receivableEntryDateInput').value = new Date().toISOString().split('T')[0];
    }
    document.getElementById('receivableEntryModal').showModal();
}

function saveReceivableEntry() {
    const recId = document.getElementById('activeReceivableId').value;
    const entryId = document.getElementById('activeRecEntryRecordId').value;
    const desc = document.getElementById('receivableEntryDescInput').value.trim();
    const amountInputVal = document.getElementById('receivableEntryAmountInput').value;
    
    const isNegative = amountInputVal.includes('-');
    const amountRaw = getRawNumber(amountInputVal);
    const date = document.getElementById('receivableEntryDateInput').value;

    const rec = appData.receivables.find(r => r.id === recId);
    let amount = isNegative ? -Math.abs(amountRaw) : Math.abs(amountRaw);
    
    if (!desc || isNaN(amount) || !date) return;

    if (entryId) {
        const entry = rec.entries.find(e => e.id === entryId);
        logActivity('Edited Receivable Entry', `Receivable: ${rec.name}\nDescription: ${desc}\nAmount: ${formatPHP(Math.abs(amount))}\nDate: ${date}`);
        entry.description = desc;
        entry.amount = amount;
        entry.date = date;
    } else {
        logActivity('Added Receivable Entry', `Receivable: ${rec.name}\nDescription: ${desc}\nAmount: ${formatPHP(Math.abs(amount))}\nDate: ${date}`);
        rec.entries.push({ id: generateId(), description: desc, amount: amount, date: date });
    }
    
    document.getElementById('receivableEntryModal').close();
    showToast('Entry saved.', 'success');
    fullRender();
}

function openReceivablePaymentModal(recId, paymentId = null) {
    document.getElementById('activeReceivablePaymentId').value = recId;
    document.getElementById('activeRecPaymentRecordId').value = paymentId || '';
    
    if (paymentId) {
        const rec = appData.receivables.find(r => r.id === recId);
        const payment = rec.payments.find(p => p.id === paymentId);
        document.getElementById('receivablePaymentAmountInput').value = formatForInputDisplay(payment.amount);
        document.getElementById('recPayablePaymentDateInput').value = payment.date;
    } else {
        document.getElementById('receivablePaymentAmountInput').value = '';
        document.getElementById('recPayablePaymentDateInput').value = new Date().toISOString().split('T')[0];
    }
    document.getElementById('receivablePaymentModal').showModal();
}

function saveReceivablePayment() {
    const recId = document.getElementById('activeReceivablePaymentId').value;
    const paymentId = document.getElementById('activeRecPaymentRecordId').value;
    const amountRaw = getRawNumber(document.getElementById('receivablePaymentAmountInput').value);
    const date = document.getElementById('recPayablePaymentDateInput').value;

    if (amountRaw <= 0 || !date) return;

    const rec = appData.receivables.find(r => r.id === recId);
    
    if (paymentId) {
        const payment = rec.payments.find(p => p.id === paymentId);
        logActivity('Edited Receivable Payment', `Receivable: ${rec.name}\nAmount: ${formatPHP(amountRaw)}\nDate: ${date}`);
        payment.amount = amountRaw;
        payment.date = date;
    } else {
        logActivity('Logged Receivable Payment', `Receivable: ${rec.name}\nAmount: ${formatPHP(amountRaw)}\nDate: ${date}`);
        rec.payments.push({ id: generateId(), amount: amountRaw, date: date });
    }
    
    document.getElementById('receivablePaymentModal').close();
    showToast('Payment saved.', 'success');
    fullRender();
}

function deleteReceivableEntry(recId, entryId, e) {
    e.stopPropagation();
    const rec = appData.receivables.find(r => r.id === recId);
    customConfirm("Delete this entry?", () => {
        logActivity('Deleted Receivable Entry', `Receivable: ${rec.name}`);
        rec.entries = rec.entries.filter(en => en.id !== entryId);
        showToast('Entry deleted.', 'error');
        fullRender();
    });
}

function deleteReceivablePayment(recId, paymentId, e) {
    e.stopPropagation();
    const rec = appData.receivables.find(r => r.id === recId);
    customConfirm("Delete this payment record?", () => {
        logActivity('Deleted Receivable Payment', `Receivable: ${rec.name}`);
        rec.payments = rec.payments.filter(p => p.id !== paymentId);
        showToast('Payment deleted.', 'error');
        fullRender();
    });
}

function renderReceivables() {
    const container = document.getElementById('receivablesContainer');
    const emptyState = document.getElementById('receivablesEmptyState');

    if (!appData.receivables || appData.receivables.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    let html = '';

    appData.receivables.forEach(rec => {
        let totalDebt = 0;
        let totalAdjustments = 0;
        let totalPaid = 0;
        let combined = [];
        
        rec.entries.forEach(e => {
            if (e.amount > 0) totalDebt += e.amount;
            else totalAdjustments += Math.abs(e.amount);
            combined.push({...e, type: 'entry'});
        });
        
        rec.payments.forEach(p => {
            totalPaid += p.amount;
            combined.push({...p, type: 'payment'});
        });
        
        combined.sort((a,b) => new Date(b.date) - new Date(a.date));
        
        let visibleHtml = '';
        let hiddenHtml = '';
        
        combined.forEach((item, idx) => {
            let itemHtml = '';
            if (item.type === 'entry') {
                let isNeg = item.amount < 0;
                itemHtml = `
                    <div class="comment-item" style="margin-bottom: 0.25rem; font-size: 0.75rem;">
                        <div style="display:flex; flex-direction:column; gap:0.2rem; flex:1;">
                            <div style="display:flex; justify-content:space-between;">
                                <span style="font-weight:600;">${item.description}</span>
                                <span style="font-weight:600; color: ${isNeg ? 'var(--danger)' : 'var(--text-main)'}">${isNeg ? '-' : ''}${formatPHP(Math.abs(item.amount))}</span>
                            </div>
<div style="display: flex; gap: 0.5rem;">
    <button class="btn-icon" style="padding:0; height:auto; width:auto; border:none; background:transparent;" onclick="openReceivableEntryModal('${rec.id}', '${item.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
    <button class="comment-delete" onclick="deleteReceivableEntry('${rec.id}', '${item.id}', event)">✕</button>
</div>
                        </div>
                    </div>
                `;
            } else {
                itemHtml = `
                    <div class="comment-item" style="margin-bottom: 0.25rem; font-size: 0.75rem; background-color: var(--primary-light); border-color: var(--primary);">
                        <div style="display:flex; flex-direction:column; gap:0.2rem; flex:1;">
                            <div style="display:flex; justify-content:space-between;">
                                <span style="font-weight:600; color: var(--primary-hover);">Payment Received</span>
                                <span style="font-weight:600; color: var(--primary-hover);">${formatPHP(item.amount)}</span>
                            </div>
<div style="display: flex; gap: 0.5rem;">
    <button class="btn-icon" style="padding:0; height:auto; width:auto; border:none; background:transparent; color: var(--primary-hover);" onclick="openReceivablePaymentModal('${rec.id}', '${item.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
    <button class="comment-delete" style="color: var(--primary-hover); background: transparent;" onclick="deleteReceivablePayment('${rec.id}', '${item.id}', event)">✕</button>
</div>
                        </div>
                    </div>
                `;
            }
            if (idx < 3) visibleHtml += itemHtml;
            else hiddenHtml += itemHtml;
        });
        
        let finalEntriesHtml = visibleHtml;
        if (hiddenHtml) {
            finalEntriesHtml += `<div id="hidden_rec_${rec.id}" style="display:none;">${hiddenHtml}</div>`;
            finalEntriesHtml += `<button class="btn-small" onclick="toggleEntries('hidden_rec_${rec.id}', this)">Show More History</button>`;
        }
        
        let remaining = totalDebt - totalAdjustments - totalPaid;
        let isFullyPaid = (remaining <= 0 && totalDebt > 0);
        
        html += `
            <div class="card" style="border-left: 4px solid ${isFullyPaid ? 'var(--positive)' : 'var(--primary)'}; opacity: ${isFullyPaid ? '0.7' : '1'};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                    <div>
                        <h3 style="margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem;">
                            ${rec.name} ${isFullyPaid ? '<span class="status-paid" style="font-size:0.6rem; padding:0.1rem 0.4rem; border-radius:4px;">FULLY PAID</span>' : ''}
                        </h3>
                    </div>
                    <div class="actions-group">
                        <button class="btn-icon" style="color: var(--danger);" onclick="deleteReceivable('${rec.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                    </div>
                </div>
                <div style="margin-bottom: 1rem;">
                    <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Remaining to Collect</div>
                    <div class="value" style="color: ${isFullyPaid ? 'var(--positive)' : 'var(--primary)'}; word-break: break-word; overflow-wrap: break-word; font-size: clamp(1.5rem, 5vw, 2.25rem);">${formatPHP(Math.max(0, remaining))}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">Total Debt: ${formatPHP(totalDebt)}</div>
                </div>
                <div style="border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem;">
                    <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
                        Entries & Payments
                        <span style="color: var(--positive); font-weight: 500;">Collected: ${formatPHP(totalPaid)}</span>
                    </div>
                    <div class="comments-list" style="margin-bottom: 1rem; max-height: none; overflow-y: visible;">
                        ${finalEntriesHtml || '<div style="font-size:0.75rem; color: var(--text-muted); text-align: center; padding: 1rem 0;">No entries yet.</div>'}
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn-secondary" style="flex:1; justify-content: center; background: transparent; padding: 0.4rem;" onclick="openReceivableEntryModal('${rec.id}')">+ Add Entry</button>
                        ${!isFullyPaid ? `<button class="btn-secondary" style="flex:1; justify-content: center; background: var(--primary-light); color: var(--primary-hover); border-color: var(--primary-light); padding: 0.4rem;" onclick="openReceivablePaymentModal('${rec.id}')">+ Log Payment</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

const sharedLegendConfig = { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 20 } };

function renderCharts() {
    if (typeof Chart === 'undefined') return; 
    
    const isMobile = window.innerWidth <= 768;
    
    const sharedLegendConfig = { 
        position: 'bottom', 
        labels: { 
            usePointStyle: true, 
            pointStyle: 'rectRounded', 
            padding: isMobile ? 15 : 20,
            font: { size: isMobile ? 11 : 12 }
        } 
    };
    
    const validRows = appData.rows.filter(r => parseFloat(r.salary) > 0);
    const dates = validRows.map(r => r.isSpecial && r.name ? `${r.date} (${r.name})` : r.date);
    
    document.getElementById('combinedLineChart').parentElement.style.height = isMobile ? '300px' : '350px';

    if(charts.combinedLine) charts.combinedLine.destroy();
    charts.combinedLine = new Chart(document.getElementById('combinedLineChart'), {
        type: 'line', 
        data: { 
            labels: dates, 
            datasets: [
                { label: 'Salary Received', data: validRows.map(r => parseFloat(r.salary) || 0), borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3, pointStyle: 'rect' },
                { label: 'Savings Allocated', data: validRows.map(r => r.entries['cat_savings'] ? (parseFloat(r.entries['cat_savings'].amount) || 0) : 0), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.3, pointStyle: 'rect' }
            ] 
        },
        options: { plugins: { legend: sharedLegendConfig }, maintainAspectRatio: false }
    });

    let expenseTotals = {};
    appData.categories.forEach(c => { if(c.id !== 'cat_savings') expenseTotals[c.name] = 0; });
    appData.rows.forEach(r => { appData.categories.forEach(c => { if (c.id !== 'cat_savings' && r.entries[c.id]) expenseTotals[c.name] += (parseFloat(r.entries[c.id].amount) || 0); }); });

    const baseColors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', 
        '#ec4899', '#f97316', '#14b8a6', '#84cc16', '#6366f1', '#eab308', 
        '#d946ef', '#0ea5e9', '#f43f5e', '#22c55e', '#a855f7', '#64748b',
        '#fbbf24', '#34d399', '#fb7185', '#818cf8', '#c084fc', '#2dd4bf'
    ];

    const expLabels = Object.keys(expenseTotals).filter(k => expenseTotals[k] > 0);
    const expData = expLabels.map(k => expenseTotals[k]);
    const expBgColors = expLabels.map((_, i) => baseColors[i % baseColors.length]);
    
    const basePieHeight = isMobile ? 220 : 280;
    const legendHeightPerItem = isMobile ? 20 : 15;
    
    const expHeight = basePieHeight + (expLabels.length * legendHeightPerItem);
    document.getElementById('expensesPieChart').parentElement.style.height = expHeight + 'px';

    if(charts.expenses) charts.expenses.destroy();
    charts.expenses = new Chart(document.getElementById('expensesPieChart'), {
        type: 'pie',
        data: { labels: expLabels, datasets: [{ data: expData, backgroundColor: expBgColors, borderWidth: 0 }] },
        options: { 
            maintainAspectRatio: false, 
            plugins: { 
                legend: sharedLegendConfig, 
                tooltip: { callbacks: { label: function(ctx) { return ` ₱${ctx.raw.toLocaleString()} (${Math.round((ctx.raw/expData.reduce((a,b)=>a+b,0))*100)}%)`; } } } 
            }, 
            onClick: (e, elements) => { if (elements.length > 0) showBreakdown(expLabels[elements[0].index]); } 
        }
    });

    const ccCategories = appData.categories.filter(c => c.name.toLowerCase().includes('credit') || c.name.toLowerCase().includes('cc'));
    const ccCanvasWrapper = document.getElementById('ccCanvasWrapper');
    if (ccCategories.length === 0) {
        ccCanvasWrapper.style.display = 'none'; 
        document.getElementById('ccEmptyState').style.display = 'block'; 
        document.getElementById('ccTotalDisplay').innerText = `Total Paid: ₱0.00`;
    } else {
        ccCanvasWrapper.style.display = 'block'; 
        document.getElementById('ccEmptyState').style.display = 'none';
        let totalCCPaid = 0, ccDataArray = [], ccLabelArray = [];
        ccCategories.forEach(cc => { let paid = 0; appData.rows.forEach(r => { if (r.entries[cc.id]) paid += (parseFloat(r.entries[cc.id].amount) || 0); }); ccLabelArray.push(cc.name); ccDataArray.push(paid); totalCCPaid += paid; });
        const ccBgColors = ccLabelArray.map((_, i) => baseColors.slice().reverse()[i % baseColors.length]);

        const ccHeight = basePieHeight + (ccLabelArray.length * legendHeightPerItem);
        ccCanvasWrapper.style.height = ccHeight + 'px';

        document.getElementById('ccTotalDisplay').innerText = `Total Paid: ${formatPHP(totalCCPaid)}`;
        if(charts.cc) charts.cc.destroy();
        charts.cc = new Chart(document.getElementById('ccPieChart'), { 
            type: 'pie', 
            data: { labels: ccLabelArray, datasets: [{ data: ccDataArray, backgroundColor: ccBgColors, borderWidth: 0 }] }, 
            options: { maintainAspectRatio: false, plugins: { legend: sharedLegendConfig, tooltip: { callbacks: { label: function(ctx) { return ` ₱${ctx.raw.toLocaleString()}`; } } } } } 
        });
    }
}

function updateDashboardMetrics() { const now = new Date(); let net = 0, exp = 0, sav = 0; appData.rows.forEach(r => { if (new Date(r.date) <= now) { net += parseFloat(r.salary) || 0; appData.categories.forEach(c => { if (r.entries[c.id]) { const a = parseFloat(r.entries[c.id].amount) || 0; if (c.id === 'cat_savings') sav += a; else exp += a; } }); } }); document.getElementById('dashNetPay').innerText = formatPHP(net); document.getElementById('dashExpenses').innerText = formatPHP(exp); document.getElementById('dashSavings').innerText = formatPHP(sav); }

// --- AUTHENTICATION & CLOUD SYNC LOGIC ---
function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    
    // Show the loading screen so the user knows the app is processing
    document.getElementById('initialLoader').style.display = 'flex';
    const loaderText = document.getElementById('loaderText');
    if (loaderText) loaderText.innerText = "Connecting to Google...";
    
    // Use the Popup method (PWABuilder handles popups perfectly without reloading the app)
    auth.signInWithPopup(provider).then((result) => {
        if (loaderText) loaderText.innerText = "Syncing with cloud...";
        showToast("Login successful!", "success");
        // Firebase's onAuthStateChanged will take over from here to load the dashboard
    }).catch(error => {
        // If the user cancels or an error occurs, hide the loader and show a toast
        document.getElementById('initialLoader').style.display = 'none';
        showToast("Login Error: " + error.message, "error");
    });
}

auth.getRedirectResult().then((result) => {
    if (result.user) {
        showToast("Successfully logged in!", "success");
    }
}).catch((error) => {
    showToast("Login error: " + error.message, "error");
});

function startOffline() {
    isOfflineMode = true;
    document.getElementById('landingPage').style.display = 'none';
    
    const local = localStorage.getItem('allocTracker2026');
    if (local) {
        appData = JSON.parse(local);
    }
    
    // Set profile names for offline mode
    document.getElementById('profileUserName').innerText = "Offline Mode";
    document.getElementById('profileUserEmail').innerText = "Not connected to cloud";
    document.getElementById('btnProfileSignOut').style.display = "none";
    
    runMigrations();
    fullRender();
    showToast("Running in offline mode.", "info");
}

function loadDataFromFirebase() {
    if (!currentUser) return;
    
    db.collection("users").doc(currentUser.uid).get().then((doc) => {
        if (doc.exists && doc.data().trackerData) {
            appData = JSON.parse(doc.data().trackerData);
            showToast("Data synced from cloud.", "success");
        } else {
            const local = localStorage.getItem('allocTracker2026');
            if (local) {
                appData = JSON.parse(local);
                showToast("Local data migrated to cloud.", "success");
            }
            saveData(true);
        }
        runMigrations();
        fullRender();
    }).catch((error) => {
        showToast("Error loading cloud data. Using local backup.", "error");
        
        const local = localStorage.getItem('allocTracker2026');
        if (local) appData = JSON.parse(local);
        
        runMigrations();
        fullRender(); 
    });
}

function logoutFirebase() {
    auth.signOut().then(() => {
        window.location.reload(); 
    });
}

function runMigrations() {
    if (!appData.activityLog) { appData.activityLog = []; }
    if (appData.loans) { appData.payables = appData.loans; delete appData.loans; }
    if (!appData.payables) { appData.payables = []; }
    if (!appData.receivables) { appData.receivables = []; }
    if (!appData.savingsAccounts) { appData.savingsAccounts = []; }
    
    appData.savingsAccounts.forEach(acc => {
        if (!acc.owner) acc.owner = 'Owner';
        if (!acc.transactions) {
            acc.transactions = acc.history || [];
            delete acc.history; delete acc.totalSavings; delete acc.debts;
        }
        acc.transactions.forEach(t => { if (!t.person) t.person = acc.owner; });
    });

    appData.receivables.forEach(rec => {
        if (!rec.payments) rec.payments = [];
        if (rec.entries) {
            rec.entries.forEach(e => { if (e.isPaid !== undefined) delete e.isPaid; });
        }
    });

    appData.rows.forEach(row => {
        if(row.entries) {
            Object.values(row.entries).forEach(entry => {
                if (entry.comment && !entry.comments) {
                    entry.comments = [{ title: 'Legacy Note', body: entry.comment }];
                    delete entry.comment;
                }
            });
        }
    });
}

// --- SAVINGS TRACKER LOGIC ---
function openSavingsSetupModal() {
    document.getElementById('savingsNameInput').value = '';
    document.getElementById('savingsOwnerInput').value = '';
    document.getElementById('savingsSetupModal').showModal();
}

function saveSavingsAccount() {
    const name = document.getElementById('savingsNameInput').value.trim();
    const owner = document.getElementById('savingsOwnerInput').value.trim() || 'Owner';
    if(!name) return;

    logActivity('Added Savings Account', `Account: ${name}\nOwner: ${owner}`);
    appData.savingsAccounts.push({ id: generateId(), name: name, owner: owner, transactions: [] });
    document.getElementById('savingsSetupModal').close();
    showToast('Savings account added.', 'success');
    fullRender();
}

function deleteSavingsAccount(id) {
    const acc = appData.savingsAccounts.find(s => s.id === id);
    customConfirm("Delete this savings entry completely? All history will be lost.", () => {
        logActivity('Deleted Savings Account', `Account: ${acc.name}`);
        appData.savingsAccounts = appData.savingsAccounts.filter(s => s.id !== id);
        showToast('Savings account deleted.', 'error');
        fullRender();
    });
}

function handleSavingsPersonChange() {
    const val = document.getElementById('savingsTransPersonSelect').value;
    const input = document.getElementById('savingsTransNewPersonInput');
    input.style.display = val === '_NEW_' ? 'block' : 'none';
    if (val === '_NEW_') input.focus();
}

function openSavingsTransactionModal(accId, transId = null) {
    document.getElementById('activeSavingsId').value = accId;
    document.getElementById('activeSavingsTransId').value = transId || '';
    
    const acc = appData.savingsAccounts.find(a => a.id === accId);
    
    let persons = new Set();
    acc.transactions.forEach(t => { if (t.person) persons.add(t.person); });
    persons.delete(acc.owner); 
    
    const select = document.getElementById('savingsTransPersonSelect');
    let html = `<option value="${acc.owner}">${acc.owner} (Owner)</option>`;
    persons.forEach(p => {
        html += `<option value="${p}">${p}</option>`;
    });
    html += `<option value="_NEW_">+ Add new person...</option>`;
    select.innerHTML = html;
    
    const newPersonInput = document.getElementById('savingsTransNewPersonInput');
    newPersonInput.style.display = 'none';
    newPersonInput.value = '';

    if (transId) {
        document.getElementById('savingsTransModalTitle').innerText = "Edit Transaction";
        const t = acc.transactions.find(tx => tx.id === transId);
        document.getElementById('savingsTransTypeInput').value = t.type;
        document.getElementById('savingsTransAmountInput').value = formatForInputDisplay(t.amount);
        
        select.value = t.person;
        if (!select.value) { 
            select.value = "_NEW_";
            newPersonInput.style.display = 'block';
            newPersonInput.value = t.person;
        }
        
        document.getElementById('savingsTransDescInput').value = t.desc || '';
        document.getElementById('savingsTransDateInput').value = t.date;
    } else {
        document.getElementById('savingsTransModalTitle').innerText = "Log Savings Transaction";
        document.getElementById('savingsTransTypeInput').value = 'deposit';
        document.getElementById('savingsTransAmountInput').value = '';
        document.getElementById('savingsTransDescInput').value = '';
        select.value = acc.owner;
        
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('savingsTransDateInput').value = `${yyyy}-${mm}-${dd}`;
    }
    
    document.getElementById('savingsTransactionModal').showModal();
}

function saveSavingsTransaction() {
    const accId = document.getElementById('activeSavingsId').value;
    const transId = document.getElementById('activeSavingsTransId').value;
    const type = document.getElementById('savingsTransTypeInput').value;
    const amountRaw = getRawNumber(document.getElementById('savingsTransAmountInput').value);
    
    const selectVal = document.getElementById('savingsTransPersonSelect').value;
    let person = selectVal === '_NEW_' ? document.getElementById('savingsTransNewPersonInput').value.trim() : selectVal;
    
    const desc = document.getElementById('savingsTransDescInput').value.trim();
    const date = document.getElementById('savingsTransDateInput').value;

    if (amountRaw <= 0 || !date) return;

    const acc = appData.savingsAccounts.find(a => a.id === accId);
    if (!acc) return;
    if (!person) person = acc.owner;

    logActivity(`${transId ? 'Edited' : 'Logged'} Savings Transaction`, `Account: ${acc.name}\nType: ${type}\nAmount: ${formatPHP(amountRaw)}\nPerson/Entity: ${person}\nDate: ${date}\nDesc: ${desc}`);

    if (transId) {
        const t = acc.transactions.find(tx => tx.id === transId);
        t.type = type;
        t.amount = amountRaw;
        t.person = person;
        t.desc = desc;
        t.date = date;
    } else {
        acc.transactions.push({ 
            id: generateId(), 
            type: type, 
            amount: amountRaw, 
            person: person,
            desc: desc, 
            date: date 
        });
    }

    acc.transactions.sort((a,b) => new Date(b.date) - new Date(a.date));

    document.getElementById('savingsTransactionModal').close();
    showToast('Savings transaction saved.', 'success');
    fullRender();
}

function deleteSavingsTransaction(accId, transId, e) {
    e.stopPropagation();
    const acc = appData.savingsAccounts.find(a => a.id === accId);
    customConfirm("Delete this transaction?", () => {
        logActivity('Deleted Savings Transaction', `Account: ${acc.name}`);
        acc.transactions = acc.transactions.filter(t => t.id !== transId);
        showToast('Transaction deleted.', 'error');
        fullRender();
    });
}

function renderSavingsTracker() {
    const container = document.getElementById('savingsContainer');
    const emptyState = document.getElementById('savingsEmptyState');

    if (!appData.savingsAccounts || appData.savingsAccounts.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    let html = '';

    appData.savingsAccounts.forEach(acc => {
        let ownerSavings = 0;
        let debtsObj = {};
        
        acc.transactions.forEach(t => {
            if (t.type === 'deposit') {
                if (t.person === acc.owner) {
                    ownerSavings += t.amount;
                } else {
                    debtsObj[t.person] = (debtsObj[t.person] || 0) - t.amount;
                }
            } else if (t.type === 'withdraw') {
                if (t.person === acc.owner) {
                    ownerSavings -= t.amount;
                } else {
                    debtsObj[t.person] = (debtsObj[t.person] || 0) + t.amount;
                }
            }
        });

        let totalDebt = 0;
        let debtsHtml = '';
        Object.keys(debtsObj).forEach(personName => {
            const debtAmt = debtsObj[personName];
            if(debtAmt > 0) {
                totalDebt += debtAmt;
                debtsHtml += `<div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-top: 0.25rem;">
                    <span style="color: var(--danger);">Owed by ${personName}:</span>
                    <span style="font-weight: 600;">${formatPHP(debtAmt)}</span>
                </div>`;
            }
        });

        let actualBalance = ownerSavings - totalDebt;

        let visibleTransHtml = '';
        let hiddenTransHtml = '';
        
        let sortedTrans = [...acc.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        sortedTrans.forEach((t, idx) => {
            const isDeposit = t.type === 'deposit';
            const colorClass = isDeposit ? 'var(--positive)' : 'var(--danger)';
            const sign = isDeposit ? '+' : '-';
            const personTag = t.person !== acc.owner ? ` <span style="font-weight:500; font-size:0.7rem; color:var(--text-muted); background:var(--bg-body); padding:2px 4px; border-radius:4px; margin-left:4px;">${t.person}</span>` : '';
            
            let itemHtml = `
                <div class="comment-item" style="margin-bottom: 0.25rem; font-size: 0.75rem; display: flex; flex-direction: column; gap: 0.25rem;">
                    <div style="display: flex; justify-content: space-between; width: 100%;">
                        <span style="font-weight:600; flex:1;">${t.desc || (isDeposit ? 'Deposit' : 'Withdrawal')}${personTag}</span>
                        <span style="font-weight:600; color: ${colorClass}">${sign}${formatPHP(t.amount)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span style="color:var(--text-muted);">${t.date}</span>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-icon" style="padding:0; height:auto; width:auto; border:none; background:transparent;" onclick="openSavingsTransactionModal('${acc.id}', '${t.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                            <button class="comment-delete" onclick="deleteSavingsTransaction('${acc.id}', '${t.id}', event)">✕</button>
                        </div>
                    </div>
                </div>
            `;
            if (idx < 3) visibleTransHtml += itemHtml;
            else hiddenTransHtml += itemHtml;
        });

        let finalTransHtml = visibleTransHtml;
        if (hiddenTransHtml) {
            finalTransHtml += `<div id="hidden_sav_${acc.id}" style="display:none;">${hiddenTransHtml}</div>`;
            finalTransHtml += `<button class="btn-small" onclick="toggleEntries('hidden_sav_${acc.id}', this)">Show More History</button>`;
        }

        html += `
            <div class="card" style="border-left: 4px solid var(--primary);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                    <div>
                        <h3 style="margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem;">${acc.name}</h3>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">Owner: <span style="font-weight: 500;">${acc.owner}</span></div>
                    </div>
                    <div class="actions-group">
                        <button class="btn-icon" style="color: var(--danger);" onclick="deleteSavingsAccount('${acc.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                    </div>
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Total Savings (Owner)</div>
                    <div class="value" style="color: var(--primary); word-break: break-word; overflow-wrap: break-word; font-size: clamp(1.5rem, 5vw, 2.25rem);">${formatPHP(ownerSavings)}</div>
                </div>

                ${totalDebt > 0 ? `
                <div style="background: var(--danger-bg); padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem;">
                    <div style="font-size: 0.75rem; font-weight: 600; color: var(--danger); text-transform: uppercase; margin-bottom: 0.5rem;">Active Debts</div>
                    ${debtsHtml}
                </div>` : ''}

                <div style="background: var(--bg-body); padding: 0.75rem; border-radius: 6px; border: 1px dashed var(--border); margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">Actual Balance</div>
                    <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-main);">${formatPHP(actualBalance)}</div>
                </div>

                <div style="border-top: 1px solid var(--border); padding-top: 1rem;">
                    <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5rem;">Transaction History</div>
                    <div class="comments-list" style="margin-bottom: 1rem; max-height: none; overflow-y: visible;">
                        ${finalTransHtml || '<div style="font-size:0.75rem; color: var(--text-muted); text-align: center; padding: 1rem 0;">No transactions yet.</div>'}
                    </div>
                    <button class="btn-secondary" style="width: 100%; justify-content: center; background: transparent;" onclick="openSavingsTransactionModal('${acc.id}')">+ Log Transaction</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}
