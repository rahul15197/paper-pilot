export function generateICS(deadline: { date: string; description: string; consequence: string }) {
  // Parse simple dates or give a default 2-day reminder
  // For simplicity, we create an all-day event
  const now = new Date();
  
  // Format YYYYMMDD
  const formatICSDate = (d: Date) => {
    return d.toISOString().replace(/[-:]/g, '').split('T')[0] + 'T000000Z';
  };

  const id = now.getTime().toString() + "@paperpilot.ai";
  const start = formatICSDate(now); 
  const dtstamp = formatICSDate(now);

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//PaperPilot AI//Calendar Alert//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:${id}
DTSTAMP:${dtstamp}
DTSTART;VALUE=DATE:${start}
SUMMARY:${deadline.description} (PaperPilot Reminder)
DESCRIPTION:Consequence if missed: ${deadline.consequence}
END:VEVENT
END:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `reminder_${deadline.date.replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
