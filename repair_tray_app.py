
import os

file_path = r'd:\somya jain\ACMIS\dom ml pre save\fixed_tray_app.py'

with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

new_lines = []
skip = False

for i, line in enumerate(lines):
    # Fix Policy Events
    if "Suppressing POLICY_CREATED notification" in line:
        new_lines.append('                self.show_notification("✅ POLICY CREATED!", "New firewall policy saved successully")\n')
        new_lines.append('                print(f"✅ POLICY_CREATED notification sent")\n')
    elif "Suppressing POLICY_EDITED notification" in line:
        new_lines.append('                self.show_notification("✅ POLICY SAVED!", "Firewall policy changes saved successfully")\n')
        new_lines.append('                print(f"✅ POLICY_EDITED notification sent")\n')
    
    # Fix Interface Events    
    elif "Suppressing INTERFACE_CREATED notification" in line:
         new_lines.append('                self.show_notification("✅ INTERFACE CREATED!", "Interface saved successfully")\n')
         new_lines.append('                print(f"✅ INTERFACE_CREATED notification sent")\n')
    elif "Suppressing INTERFACE_EDITED notification" in line:
         new_lines.append('                self.show_notification("✅ INTERFACE SAVED!", "Interface changes saved successfully")\n')
         new_lines.append('                print(f"✅ INTERFACE_EDITED notification sent")\n')
    
    else:
        new_lines.append(line)

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("✅ File repaired successfully")
