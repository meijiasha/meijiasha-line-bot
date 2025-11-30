// debug_is_open.js

function isOpenNow(periods) {
    try {
        if (!periods || !Array.isArray(periods) || periods.length === 0) {
            return null; // Unknown
        }

        // Get current time in Taipei
        const now = new Date();

        // Use toLocaleString to get the time in Taipei
        // We don't need Intl.DateTimeFormat with 'weekday: numeric' which causes a crash
        const taipeiTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
        const taipeiDate = new Date(taipeiTimeStr);

        // Check if date parsing was successful
        if (isNaN(taipeiDate.getTime())) {
            console.error('Failed to parse Taipei time:', taipeiTimeStr);
            return null;
        }

        const currentDay = taipeiDate.getDay(); // 0 (Sun) - 6 (Sat)
        const currentHours = taipeiDate.getHours();
        const currentMinutes = taipeiDate.getMinutes();
        const currentTime = currentHours * 100 + currentMinutes; // HHMM format as integer

        console.log(`Current Day: ${currentDay}, Current Time: ${currentTime}`);

        return false; // Dummy return
    } catch (error) {
        console.error('CRASH in isOpenNow:', error);
        throw error;
    }
}

// Run test
console.log('Running debug test...');
isOpenNow([{ open: { day: 1, time: '0900' } }]);
