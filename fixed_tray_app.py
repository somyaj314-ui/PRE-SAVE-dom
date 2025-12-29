#!/usr/bin/env python3
"""
FortiGate Monitor Tray App - WORKING VERSION
HTTP-based with system tray integration
"""

import json
import threading
import time
from datetime import datetime
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

# GUI imports
try:
    import pystray
    from PIL import Image, ImageDraw
    import tkinter as tk
    from tkinter import messagebox
except ImportError:
    print("Installing required packages...")
    os.system("pip install pystray pillow")
    import pystray
    from PIL import Image, ImageDraw
    import tkinter as tk
    from tkinter import messagebox

class FortiGateClassifier:
    def __init__(self):
        print("✅ Change Management Classifier initialized")
        
        # Load synthetic training data
        self.change_patterns = self._load_change_patterns()
        
        # Define detection patterns
        self.url_patterns = [
            r'fortigate', r'fortinet', r'fgt', r'/ng/page', 
            r'/api/v2/cmdb', r'fortimanager', r'fortianalyzer',
            r'/logindisclaimer', r'/logincheck', r'/remote/login'
        ]
        
        # SPECIFIC CHANGE MANAGEMENT PATTERNS
        self.change_management_patterns = {
            # 'firewall_policy': [
            #     r'/ng/firewall/policy/edit',
            #     r'/ng/firewall/policy/create', 
            #     r'/ng/firewall/policy/clone',
            #     r'/api/v2/cmdb/firewall/policy',
            #     r'firewall.*policy.*edit',
            #     r'firewall.*policy.*create'
            # ],
            'user_management': [
                r'/ng/user/local/edit',
                r'/ng/user/local/create',
                r'/ng/user/group/edit',
                r'/api/v2/cmdb/user/local',
                r'/api/v2/cmdb/user/group',
                r'user.*local.*edit',
                r'user.*local.*create',
                r'user.*management'
            ],
            'password_policy': [
                r'/ng/system/password-policy',
                r'/ng/system/admin/password',
                r'/ng/user/password-policy',
                r'/api/v2/cmdb/system/password-policy',
                r'/api/v2/cmdb/system/global',
                r'/api/v2/cmdb/system/admin',
                r'password.*policy',
                r'password.*requirement',
                r'password.*strength',
                r'admin.*password',
                r'change.*password',
                r'reset.*password'
            ]
        }
        
        # Form submission indicators
        self.form_submission_indicators = [
            'apply', 'save', 'create', 'update', 'delete', 'ok', 'submit',
            'change', 'reset', 'set'  # Added for password changes
        ]
        
        # Change methods that indicate actual modifications
        self.change_methods = ['POST', 'PUT', 'DELETE', 'PATCH']
        
        # IP address patterns for FortiGate devices (with optional port)
        self.ip_patterns = [
            r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/logindisclaimer',
            r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/logincheck',
            r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/ng/',
            r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/api/v2',
            r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/remote/login'
        ]
        
        # FortiGate-specific path patterns (works with any domain/IP)
        self.fortigate_paths = [
            r'/ng/system/dashboard',
            r'/ng/firewall/policy',
            r'/ng/system/interface',
            r'/ng/user/local',
            r'/ng/vpn/ssl',
            r'/ng/system/admin',
            r'/ng/system/global',
            r'/ng/system/password-policy',
            r'/ng/user/password-policy',
            r'/ng/log/fortiview',
            r'/ng/monitor/system',
            r'/api/v2/cmdb/',
            r'/api/v2/monitor/',
            r'/api/v2/monitor/fortiview',
            r'/logindisclaimer',
            r'/logincheck',
            r'/remote/login'
        ]
        
        # FortiGate-specific keywords in URL parameters
        self.fortigate_keywords = [
            r'vdom=',
            r'fortiview',
            r'fortigate',
            r'fortinet',
            r'csf=',
            r'device=fortianalyzer'
        ]
        
        self.api_patterns = [
            r'/api/v2/cmdb/firewall/policy',
            r'/api/v2/cmdb/system/interface',
            r'/api/v2/cmdb/user/local',
            r'/api/v2/cmdb/vpn/ssl',
            r'/logincheck',
            r'/logindisclaimer',
            r'/remote/login'
        ]
        

    def predict(self, browser_data):
        """Detect specific FortiGate change management activities"""
        
        # Extract data for analysis
        url = self._extract_url(browser_data)
        page_title = self._extract_page_title(browser_data)
        dom_elements = self._extract_dom_elements(browser_data)
        event_type = browser_data.get('type', 'unknown')
        method = browser_data.get('data', {}).get('method', 'GET') if isinstance(browser_data.get('data'), dict) else 'GET'
        
        # DEBUG: Show extracted data
        print(f"      🔍 Extracted Data:")
        print(f"         URL: {url}")
        print(f"         Event Type: {event_type}")
        print(f"         Method: {method}")
        print(f"         Title: {page_title}")
        
        # Check for specific change management activities
        change_detection = self._detect_specific_changes(url, method, event_type, page_title, dom_elements)
        
        if change_detection['is_change_event']:
            return {
                "is_fortigate": True,
                "change_type": change_detection['change_type'],
                "change_action": change_detection['action'],
                "is_change_management": True
            }
        
        # Fallback to general FortiGate detection
        url_score = self._score_url(url)
        api_score = self._score_api_calls(url)
        dom_score = self._score_dom_elements(dom_elements)
        title_score = self._score_page_title(page_title)
        
        final_score = (url_score * 0.7 + api_score * 0.15 + dom_score * 0.1 + title_score * 0.05)
        is_fortigate = final_score > 0.25
        
        return {
            "is_fortigate": is_fortigate,
            "change_type": self._detect_change_type(url, dom_elements, page_title),
            "change_action": None,
            "is_change_management": False
        }
    
    def _extract_url(self, data):
        """Extract URL from browser data"""
        if isinstance(data, dict):
            if 'data' in data:
                return data['data'].get('pageUrl', '') or data['data'].get('url', '')
            return data.get('pageUrl', '') or data.get('url', '')
        return str(data)
    
    def _extract_page_title(self, data):
        """Extract page title"""
        if isinstance(data, dict) and 'data' in data:
            return data['data'].get('pageTitle', '')
        return ''
    
    def _extract_dom_elements(self, data):
        """Extract DOM elements for analysis"""
        elements = []
        if isinstance(data, dict) and 'data' in data:
            browser_data = data['data']
            
            # Extract form field names
            if 'forms' in browser_data:
                for form in browser_data['forms']:
                    for field in form.get('fields', []):
                        elements.append(field.get('name', ''))
            
            # Extract button text
            if 'buttons' in browser_data:
                for btn in browser_data['buttons']:
                    elements.append(btn.get('text', ''))
            
            # Extract visible text
            if 'textContent' in browser_data:
                for item in browser_data['textContent'][:10]:
                    elements.append(item.get('text', ''))
        
        return ' '.join(elements).lower()
    
    def _score_url(self, url):
        """Score URL patterns including IP addresses and FortiGate paths"""
        import re
        url_lower = url.lower()
        
        # Check regular URL patterns
        url_matches = sum(1 for pattern in self.url_patterns 
                         if re.search(pattern, url_lower))
        
        # Check IP address patterns (higher weight)
        ip_matches = sum(1 for pattern in self.ip_patterns 
                        if re.search(pattern, url))
        
        # Check FortiGate-specific paths (works with any domain/IP)
        path_matches = sum(1 for pattern in self.fortigate_paths 
                          if re.search(pattern, url_lower))
        
        # Check FortiGate-specific keywords in URL
        keyword_matches = sum(1 for keyword in self.fortigate_keywords 
                             if re.search(keyword, url_lower))
        
        # Check if it's an IP-based URL (with optional port)
        is_ip_url = re.search(r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/', url)
        ip_path_bonus = 0
        if is_ip_url and (path_matches > 0 or keyword_matches > 0):
            ip_path_bonus = 0.3  # Extra bonus for IP + FortiGate indicators
        
        # DEBUG: Print what we found
        print(f"      🔍 URL Debug: {url[:100]}...")
        print(f"      📊 url_matches: {url_matches}/{len(self.url_patterns)}")
        print(f"      📊 ip_matches: {ip_matches}/{len(self.ip_patterns)}")
        print(f"      📊 path_matches: {path_matches}/{len(self.fortigate_paths)}")
        print(f"      📊 keyword_matches: {keyword_matches}/{len(self.fortigate_keywords)}")
        print(f"      📊 is_ip_url: {bool(is_ip_url)}")
        print(f"      📊 ip_path_bonus: {ip_path_bonus}")
        
        # Calculate total score with weights
        total_score = (
            (url_matches / len(self.url_patterns)) * 0.2 +
            (ip_matches / len(self.ip_patterns)) * 0.3 +
            (path_matches / len(self.fortigate_paths)) * 0.3 +
            (keyword_matches / len(self.fortigate_keywords)) * 0.4 +
            ip_path_bonus
        )
        
        print(f"      📊 total_score: {total_score}")
        
        return min(total_score, 1.0)
    
    def _score_api_calls(self, url):
        """Score API endpoint patterns"""
        import re
        url_lower = url.lower()
        matches = sum(1 for pattern in self.api_patterns 
                     if re.search(pattern, url_lower))
        
        # Extra bonus for IP-based API calls
        if re.search(r'https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/', url):
            matches += 0.5  # Bonus for IP-based URLs
            
        return min(matches / len(self.api_patterns), 1.0) * 2  # API calls are strong indicators
    
    def _score_dom_elements(self, dom_text):
        """Score DOM element signatures"""
        matches = sum(1 for signature in self.dom_signatures 
                     if signature in dom_text)
        return min(matches / len(self.dom_signatures), 1.0)
    
    def _score_page_title(self, title):
        """Score page title"""
        title_lower = title.lower()
        matches = sum(1 for pattern in self.page_titles 
                     if pattern in title_lower)
        return min(matches / len(self.page_titles), 1.0)
    
    def _detect_specific_changes(self, url, method, event_type, page_title, dom_elements):
        """Detect specific change management activities"""
        import re
        
        url_lower = url.lower()
        combined_text = f"{url} {page_title} {dom_elements}".lower()
        
        print(f"         🔍 Change Detection Debug:")
        print(f"            URL (lower): {url_lower}")
        print(f"            Method: {method}")
        print(f"            Event Type: {event_type}")
        
        # # Check firewall policy changes
        # for pattern in self.change_management_patterns['firewall_policy']:
        #     if re.search(pattern, url_lower) or re.search(pattern, combined_text):
        #         print(f"            ✅ Matched firewall pattern: {pattern}")
        #         action = self._determine_action(url, method, event_type, dom_elements)
        #         print(f"            🎯 Determined action: {action}")
        #         if action:  # Only alert on actual changes
        #             return {
        #                 'is_change_event': True,
        #                 'change_type': 'firewall_policy',
        #                 'action': action
        #             }
        
        # Check user management changes  
        for pattern in self.change_management_patterns['user_management']:
            if re.search(pattern, url_lower) or re.search(pattern, combined_text):
                print(f"            ✅ Matched user management pattern: {pattern}")
                action = self._determine_action(url, method, event_type, dom_elements)
                print(f"            🎯 Determined action: {action}")
                if action:  # Only alert on actual changes
                    return {
                        'is_change_event': True,
                        'change_type': 'user_management', 
                        'action': action
                    }
        
        # Check password policy changes (NEW)
        for pattern in self.change_management_patterns['password_policy']:
            if re.search(pattern, url_lower) or re.search(pattern, combined_text):
                print(f"            ✅ Matched password policy pattern: {pattern}")
                action = self._determine_action(url, method, event_type, dom_elements)
                print(f"            🎯 Determined action: {action}")
                if action:  # Only alert on actual changes
                    return {
                        'is_change_event': True,
                        'change_type': 'password_policy', 
                        'action': action
                    }
        
        print(f"            ❌ No change management patterns matched")
        return {'is_change_event': False}
    
    def _determine_action(self, url, method, event_type, dom_elements=""):
        """Determine what type of action is being performed"""
        
        print(f"               🎯 Action Detection:")
        print(f"                  Event Type: {event_type}")
        print(f"                  Method: {method}")
        print(f"                  Change Methods: {self.change_methods}")
        print(f"                  URL: {url}")
        
        # API calls with change methods (HIGHEST PRIORITY)
        if event_type in ['API_CALL', 'API_RESPONSE'] and method in self.change_methods:
            print(f"                  ✅ API change method detected")
            if method == 'POST':
                return 'api_create'
            elif method == 'PUT':
                return 'api_update' 
            elif method == 'DELETE':
                return 'api_delete'
            elif method == 'PATCH':
                return 'api_modify'
        
        # Check for form submission indicators in DOM (MEDIUM PRIORITY)
        if event_type == 'UI_CHANGE':
            dom_lower = dom_elements.lower()
            for indicator in self.form_submission_indicators:
                if indicator in dom_lower:
                    print(f"                  ✅ Form submission indicator found: {indicator}")
                    if 'create' in dom_lower or 'add' in dom_lower:
                        return 'form_create'
                    elif 'save' in dom_lower or 'apply' in dom_lower or 'update' in dom_lower:
                        return 'form_save'
                    elif 'delete' in dom_lower or 'remove' in dom_lower:
                        return 'form_delete'
                    else:
                        return 'form_action'
        
        # UI changes on edit/create pages (LOW PRIORITY)
        if event_type == 'UI_CHANGE':
            print(f"                  🖥️  UI change detected")
            if '/edit/' in url or '/edit?' in url:
                print(f"                  ✅ Edit page detected")
                return 'edit_page'
            elif '/create' in url:
                print(f"                  ✅ Create page detected")
                return 'create_page'
            elif '/clone' in url:
                print(f"                  ✅ Clone page detected")
                return 'clone_page'
        
        print(f"                  ❌ No action determined")
        return None
    
    def _load_change_patterns(self):
        """Load synthetic change patterns for better detection"""
        try:
            with open('synthetic_fortigate_data.json', 'r') as f:
                data = json.load(f)
                print(f"📚 Loaded {len(data.get('fortigate_change_events', []))} synthetic patterns")
                return data.get('fortigate_change_events', [])
        except FileNotFoundError:
            print("💡 No synthetic data found. Run synthetic_data_generator.py first")
            return []
    
    def _detect_change_type(self, url, dom_elements, title):
        """Detect specific type of FortiGate change"""
        combined_text = f"{url} {dom_elements} {title}".lower()
        
        if any(word in combined_text for word in ['password', 'passwd', 'pwd']):
            return "password_policy"
        # elif any(word in combined_text for word in ['policy', 'firewall', 'rule']):
        #     return "firewall_policy"
        elif any(word in combined_text for word in ['interface', 'network', 'ip']):
            return "network_config"
        elif any(word in combined_text for word in ['user', 'admin', 'authentication']):
            return "user_management"
        elif any(word in combined_text for word in ['vpn', 'ipsec', 'ssl']):
            return "vpn_config"
        elif any(word in combined_text for word in ['system', 'global', 'settings']):
            return "system_config"
        else:
            return "general_config"

class TrayHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, tray_app=None, **kwargs):
        self.tray_app = tray_app
        super().__init__(*args, **kwargs)
    
    def do_POST(self):
        if self.path == '/data':
            try:
                # Read data
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data.decode('utf-8'))
                
                # Process data
                self.tray_app.process_browser_data(data)
                
                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                
                response = {"status": "success", "stats": self.tray_app.stats}
                self.wfile.write(json.dumps(response).encode())
                
            except Exception as e:
                print(f"❌ Error: {e}")
                self.send_response(500)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_OPTIONS(self):
        # Handle CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass

class TrayApp:
    def __init__(self):
        self.classifier = FortiGateClassifier()
        self.server = None
        self.icon = None
        self.running = False
        self.stats = {
            'total_events': 0,
            'fortigate_events': 0,
            'last_detection': None
        }
        
        # Deduplication tracking
        self.recent_detections = []  # Store recent detections to avoid duplicates
        self.max_recent_items = 10   # Keep last 10 detections
        self.duplicate_window = 30   # Seconds to consider as duplicate
    
    def create_icon_image(self):
        """Create system tray icon"""
        width = 64
        height = 64
        image = Image.new('RGB', (width, height), color='blue')
        draw = ImageDraw.Draw(image)
        draw.rectangle([16, 16, 48, 48], fill='white')
        draw.text((20, 25), "FG", fill='blue')
        return image
    
    def show_notification(self, title, message):
        """Show system notification - tries multiple methods"""
        print(f"🔔 NOTIFICATION: {title}")
        print(f"   {message}")
        print("-" * 60)
        
        notification_sent = False
        
        if sys.platform == "win32":
            # Method 1: Try winotify (most reliable)
            try:
                from winotify import Notification, audio
                toast = Notification(
                    app_id="FortiGate Monitor",
                    title=title,
                    msg=message,
                    duration="short"
                )
                toast.set_audio(audio.Default, loop=False)
                toast.show()
                print("✅ Notification sent via winotify")
                notification_sent = True
            except ImportError:
                print("⚠️  winotify not installed - Run: pip install winotify")
            except Exception as e:
                print(f"⚠️  winotify failed: {e}")
            
            # Method 2: Try PowerShell (works even if notifications disabled)
            if not notification_sent:
                try:
                    import subprocess
                    ps_script = f'''
                    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
                    
                    $template = @"
                    <toast>
                        <visual>
                            <binding template="ToastText02">
                                <text id="1">{title}</text>
                                <text id="2">{message[:100]}</text>
                            </binding>
                        </visual>
                        <audio src="ms-winsoundevent:Notification.Default"/>
                    </toast>
"@
                    
                    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
                    $xml.LoadXml($template)
                    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
                    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("FortiGate Monitor")
                    $notifier.Show($toast)
                    '''
                    
                    subprocess.run(
                        ["powershell", "-Command", ps_script],
                        capture_output=True,
                        timeout=3,
                        creationflags=subprocess.CREATE_NO_WINDOW
                    )
                    print("✅ Notification sent via PowerShell")
                    notification_sent = True
                except Exception as e:
                    print(f"⚠️  PowerShell notification failed: {e}")
            
            # Method 3: Fallback to system tray notification
            if not notification_sent and self.icon:
                try:
                    self.icon.notify(title, message)
                    print("✅ Notification sent via system tray")
                    notification_sent = True
                except Exception as e:
                    print(f"⚠️  System tray notification failed: {e}")
        
        if not notification_sent:
            print("⚠️  All notification methods failed!")
            print("💡 Check: ENABLE_WINDOWS_NOTIFICATIONS.md")
    
    def _create_detection_key(self, data, result):
        """Create a unique key for deduplication"""
        url = self.classifier._extract_url(data)
        event_type = data.get('type', 'unknown')
        change_type = result.get('change_type', 'unknown')
        
        # Create key from URL path + event type + change type
        from urllib.parse import urlparse
        try:
            parsed_url = urlparse(url)
            url_key = f"{parsed_url.netloc}{parsed_url.path}"
        except:
            url_key = url[:50]  # Fallback to first 50 chars
            
        return f"{event_type}:{change_type}:{url_key}"
    
    def _is_duplicate_detection(self, detection_key):
        """Check if this detection is a recent duplicate"""
        current_time = datetime.now()
        
        # Clean old detections
        self.recent_detections = [
            (key, timestamp) for key, timestamp in self.recent_detections
            if (current_time - timestamp).seconds < self.duplicate_window
        ]
        
        # Check if this key exists in recent detections
        for key, timestamp in self.recent_detections:
            if key == detection_key:
                return True
                
        # Add this detection to recent list
        self.recent_detections.append((detection_key, current_time))
        
        # Keep only recent items
        if len(self.recent_detections) > self.max_recent_items:
            self.recent_detections = self.recent_detections[-self.max_recent_items:]
            
        return False
    
    def _handle_password_change_event(self, data):
        """Handle real-time password change events (BEFORE save button)"""
        password_event_type = data.get('eventType', 'unknown')
        password_data = data.get('data', {})
        
        print(f"🔐 Password Event: {password_event_type}")
        print(f"   Field: {password_data.get('fieldName', 'unknown')}")
        print(f"   URL: {password_data.get('url', '')[:80]}...")
        print(f"   Change Type: {password_data.get('changeType', 'unknown')}")
        
        # Only show notification for actual field changes (not just page loads)
        if password_event_type in ['PASSWORD_FIELD_CHANGED', 'PASSWORD_FIELD_MODIFIED']:
            self.stats['fortigate_events'] += 1
            self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
            
            # Check for duplicates
            detection_key = f"password:{password_data.get('fieldName')}:{password_data.get('url')}"
            is_duplicate = self._is_duplicate_detection(detection_key)
            
            if not is_duplicate:
                change_type = password_data.get('changeType', 'password_field_change')
                field_name = password_data.get('fieldName', 'unknown')
                
                # Rule-based popup disabled in favor of ML
                # self.show_notification(
                #     "🔐 PASSWORD CHANGE DETECTED!",
                #     f"Field: {field_name}\nType: {change_type.replace('_', ' ').title()}\nClick Save to apply changes."
                # )
                
                print(f"🚨 PASSWORD CHANGE: {change_type} (field: {field_name})")
            else:
                print(f"   🔄 DUPLICATE: Skipping notification")
        
        elif password_event_type == 'PASSWORD_SAVE_CLICKED':
            print(f"💾 Save button clicked with password changes")
            
            # Rule-based popup disabled in favor of ML
            # self.show_notification(
            #     "💾 PASSWORD SAVED!",
            #     f"Password changes have been saved.\nFields changed: {password_data.get('passwordFieldsChanged', 0)}"
            # )
        
        elif password_event_type == 'PASSWORD_PAGE_LOADED':
            print(f"📄 Password policy page loaded")
            # Don't show notification for just loading the page
    
    def _handle_policy_live_status(self, data):
        """Handle live policy editing status (while user is typing/selecting)"""
        status_event_type = data.get('eventType', 'unknown')
        status_data = data.get('data', {})
        
        status = status_data.get('status', 'unknown')
        field_count = status_data.get('fieldCount', 0)
        message = status_data.get('message', '')
        
        print(f"⚡ Live Status: {status_event_type}")
        print(f"   Status: {status}")
        print(f"   Fields: {field_count}")
        print(f"   Message: {message}")
        
        # Only show notification while actively editing
        if status == 'EDITING' and field_count > 0:
            # Rule-based popup disabled in favor of ML
            # self.show_notification(
            #     "⚡ Policy Configuration",
            #     message
            # )
            print(f"🔔 Suppressing live editing notification (Rule-based)")
        elif status == 'STOPPED':
            print(f"⏸️ User stopped editing")
            # Don't show notification when stopped
    
    def _handle_policy_change_event(self, data):
        """Handle policy creation/edit events (simple mode - no field tracking)"""
        policy_event_type = data.get('eventType', 'unknown')
        policy_data = data.get('data', {})
        
        mode = policy_data.get('mode', 'unknown')
        status = policy_data.get('status', 'unknown')
        url = policy_data.get('url', '')
        title = policy_data.get('title', '')
        
        print(f"🛡️ Policy Event: {policy_event_type}")
        print(f"   Mode: {mode}")
        print(f"   Status: {status}")
        print(f"   URL: {url[:80]}...")
        print(f"   Title: {title}")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"policy:{policy_event_type}:{mode}:{url}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
                # Rule-based popups disabled in favor of ML
                # self.show_notification("🆕 CREATING NEW POLICY!", "User is creating a new firewall policy")
                print(f"� Suppressing POLICY_CREATING notification (Rule-based)")
            
        elif policy_event_type == 'POLICY_EDITING':
                # self.show_notification("✏️ EDITING POLICY!", "User is modifying a firewall policy.")
                print(f"� Suppressing POLICY_EDITING notification (Rule-based)")
            
        # SAVED notifications (AFTER save button)
        elif policy_event_type == 'POLICY_CREATED':
                # self.show_notification("✅ POLICY CREATED!", "New firewall policy saved successully")
                self.show_notification("✅ POLICY CREATED!", "New firewall policy saved successully")
                print(f"✅ POLICY_CREATED notification sent")
            
        elif policy_event_type == 'POLICY_EDITED':
                # self.show_notification("✅ POLICY SAVED!", "Firewall policy changes saved successfully")
                self.show_notification("✅ POLICY SAVED!", "Firewall policy changes saved successfully")
                print(f"✅ POLICY_EDITED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")
    
    """Handle admin user creation/modification events"""
    def _handle_admin_user_event(self, data):
        admin_event_type = data.get('eventType', 'unknown')
        admin_data = data.get('data', {})
        
        username = admin_data.get('username', 'Unknown')
        user_type = admin_data.get('userType', 'Unknown')
        
        print(f"👤 Admin User Event: {admin_event_type}")
        print(f"   Username: {username}")
        print(f"   Type: {user_type}")
        print(f"   URL: {admin_data.get('url', '')[:80]}...")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"admin:{username}:{admin_data.get('url')}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
            if admin_event_type == 'ADMIN_USER_CREATED':
                self.show_notification("✅ Admin User Created!", "Admin user created successfully!")
                print(f"✅ ADMIN CREATED notification sent: {username} ({user_type})")
            elif admin_event_type == 'ADMIN_USER_UPDATED' or admin_event_type == 'ADMIN_USER_MODIFIED':
                self.show_notification("✅ Admin User Updated!", "Admin user updated successfully!")
                print(f"✅ ADMIN MODIFIED notification sent: {username} ({user_type})")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")
            # Handle admin user creation/edit events (NEW)
      
    def _handle_interface_change_event(self, data):
        """Handle network interface creation/edit events"""
        interface_event_type = data.get('eventType', 'unknown')
        interface_data = data.get('data', {})
        
        mode = interface_data.get('mode', 'unknown')
        status = interface_data.get('status', 'unknown')
        url = interface_data.get('url', '')
        title = interface_data.get('title', '')
        
        print(f"🌐 Interface Event: {interface_event_type}")
        print(f"   Mode: {mode}")
        print(f"   Status: {status}")
        print(f"   URL: {url[:80]}...")
        print(f"   Title: {title}")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"interface:{interface_event_type}:{mode}:{url}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
            # Rule-based popups disabled in favor of ML
            if interface_event_type == 'INTERFACE_CREATING':
                # self.show_notification("🆕 CREATING INTERFACE!", "User is creating a new interface")
                print(f"� Suppressing INTERFACE_CREATING notification (Rule-based)")
            elif interface_event_type == 'INTERFACE_EDITING':
                # self.show_notification("✏️ EDITING INTERFACE!", "User is modifying an interface.")
                print(f"� Suppressing INTERFACE_EDITING notification (Rule-based)")
            elif interface_event_type == 'INTERFACE_CREATED':
                # self.show_notification("✅ INTERFACE CREATED!", "Interface saved successfully")
                self.show_notification("✅ INTERFACE CREATED!", "Interface saved successfully")
                print(f"✅ INTERFACE_CREATED notification sent")
            elif interface_event_type == 'INTERFACE_EDITED':
                # self.show_notification("✅ INTERFACE SAVED!", "Interface changes saved successfully")
                self.show_notification("✅ INTERFACE SAVED!", "Interface changes saved successfully")
                print(f"✅ INTERFACE_EDITED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")
        


    def _handle_dos_policy_change_event(self, data):
        """Handle DoS Policy creation/edit events"""
        dos_event_type = data.get('eventType', 'unknown')
        dos_data = data.get('data', {})
        
        mode = dos_data.get('mode', 'unknown')
        url = dos_data.get('url', '')
        message = dos_data.get('message', '')
        
        print(f"🚫 DoS Policy Event: {dos_event_type}")
        print(f"   Mode: {mode}")
        print(f"   URL: {url[:80]}...")
        print(f"   Message: {message}")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"dos_policy:{dos_event_type}:{mode}:{url}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
            # Rule-based popups disabled in favor of ML
            if dos_event_type == 'DOS_POLICY_CREATING':
                # self.show_notification("🚫 Creating DoS Policy", "User is creating a new DoS Policy...")
                print(f"🔔 Suppressing DOS_POLICY_CREATING notification (Rule-based)")
            elif dos_event_type == 'DOS_POLICY_EDITING':
                # self.show_notification("🚫 Editing DoS Policy", "User is editing a DoS policy...")
                print(f"🔔 Suppressing DOS_POLICY_EDITING notification (Rule-based)")
            elif dos_event_type == 'DOS_POLICY_CREATED':
                self.show_notification("✅ DoS Policy Created!", "DoS Policy created successfully!")
                print(f"✅ DOS_POLICY_CREATED notification sent")
            elif dos_event_type == 'DOS_POLICY_UPDATED':
                self.show_notification("✅ DoS Policy Updated!", "DoS Policy updated successfully!")
                print(f"✅ DOS_POLICY_UPDATED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")




    def _handle_address_change_event(self, data):
        """Handle Firewall Address creation/edit events"""
        address_event_type = data.get('eventType', 'unknown')
        address_data = data.get('data', {})
        
        mode = address_data.get('mode', 'unknown')
        url = address_data.get('url', '')
        message = address_data.get('message', '')
        changed_fields = address_data.get('changedFields', [])
        field_count = address_data.get('fieldCount', 0)
        
        print(f"📍 Firewall Address Event: {address_event_type}")
        print(f"   Mode: {mode}")
        print(f"   URL: {url[:80]}...")
        print(f"   Message: {message}")
        print(f"   Changed Fields ({field_count}): {changed_fields}")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"address:{address_event_type}:{mode}:{url}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
            # Format changed fields for display
            fields_text = '\n'.join([f"  • {field}" for field in changed_fields[:5]])
            if len(changed_fields) > 5:
                fields_text += f"\n  ... and {len(changed_fields) - 5} more"
            
            # Rule-based popups disabled in favor of ML
            if address_event_type == 'ADDRESS_CREATING':
                # self.show_notification("📍 Creating Address", "User is creating a new address...")
                print(f"🔔 Suppressing ADDRESS_CREATING notification (Rule-based)")
            elif address_event_type == 'ADDRESS_EDITING':
                # self.show_notification("📍 Editing Address", "User is editing an address...")
                print(f"🔔 Suppressing ADDRESS_EDITING notification (Rule-based)")
            elif address_event_type == 'ADDRESS_CREATED':
                self.show_notification("✅ Address Created!", "Address saved successfully!")
                print(f"✅ ADDRESS_CREATED notification sent")
            elif address_event_type == 'ADDRESS_UPDATED':
                self.show_notification("✅ Address Updated!", "Address updated successfully!")
                print(f"✅ ADDRESS_UPDATED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")
    def _handle_central_snat_change_event(self, data):
        """Handle Central SNAT Map creation/edit events"""
        snat_event_type = data.get('eventType', 'unknown')
        snat_data = data.get('data', {})
        
        mode = snat_data.get('mode', 'unknown')
        url = snat_data.get('url', '')
        message = snat_data.get('message', '')
        
        print(f"🔄 Central SNAT Map Event: {snat_event_type}")
        print(f"   Mode: {mode}")
        print(f"   URL: {url[:80]}...")
        print(f"   Message: {message}")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"central_snat:{snat_event_type}:{mode}:{url}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
            # Rule-based popups disabled in favor of ML
            if snat_event_type == 'CENTRAL_SNAT_CREATING':
                # self.show_notification("🔄 Creating SNAT", "User is creating a Central SNAT policy.")
                print(f"🔔 Suppressing CENTRAL_SNAT_CREATING notification (Rule-based)")
            elif snat_event_type == 'CENTRAL_SNAT_EDITING':
                # self.show_notification("🔄 Editing SNAT", "User is editing a Central SNAT policy.")
                print(f"🔔 Suppressing CENTRAL_SNAT_EDITING notification (Rule-based)")
            elif snat_event_type == 'CENTRAL_SNAT_CREATED':
                self.show_notification("✅ SNAT Created!", "Central SNAT policy saved successfully!")
                print(f"✅ CENTRAL_SNAT_CREATED notification sent")
            elif snat_event_type == 'CENTRAL_SNAT_UPDATED':
                self.show_notification("✅ SNAT Updated!", "Central SNAT policy updated successfully!")
                print(f"✅ CENTRAL_SNAT_UPDATED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")

    def _handle_firewall_service_change_event(self, data):
        """Handle Firewall Service creation/edit events"""
        service_event_type = data.get('eventType', 'unknown')
        service_data = data.get('data', {})
        
        mode = service_data.get('mode', 'unknown')
        url = service_data.get('url', '')
        message = service_data.get('message', '')
        
        print(f"🔧 Firewall Service Event: {service_event_type}")
        print(f"   Mode: {mode}")
        print(f"   URL: {url[:80]}...")
        print(f"   Message: {message}")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        # Check for duplicates
        detection_key = f"firewall_service:{service_event_type}:{mode}:{url}"
        is_duplicate = self._is_duplicate_detection(detection_key)
        
        if not is_duplicate:
            # Rule-based popups disabled in favor of ML
            if service_event_type == 'FIREWALL_SERVICE_CREATING':
                # self.show_notification("🔧 Creating Service", "User is creating a firewall service.")
                print(f"🔔 Suppressing FIREWALL_SERVICE_CREATING notification (Rule-based)")
            elif service_event_type == 'FIREWALL_SERVICE_EDITING':
                # self.show_notification("🔧 Editing Service", "User is editing a firewall service.")
                print(f"🔔 Suppressing FIREWALL_SERVICE_EDITING notification (Rule-based)")
            elif service_event_type == 'FIREWALL_SERVICE_CREATED':
                self.show_notification("✅ Service Created!", "Firewall service saved successfully!")
                print(f"✅ FIREWALL_SERVICE_CREATED notification sent")
            elif service_event_type == 'FIREWALL_SERVICE_UPDATED':
                self.show_notification("✅ Service Updated!", "Firewall service updated successfully!")
                print(f"✅ FIREWALL_SERVICE_UPDATED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")
    
    """Handle VPN change events"""
    def _handle_vpn_change_event(self, data):
        vpn_event_type = data.get('eventType', 'unknown')
        vpn_data = data.get('data', {})
        
        mode = vpn_data.get('mode', 'unknown')
        url = vpn_data.get('url', '')
        status = vpn_data.get('status', 'unknown')
        
        print(f"🔐 VPN Event: {vpn_event_type}")
        print(f"   Mode: {mode}")
        print(f"   Status: {status}")
        print(f"   URL: {url[:80]}...")
        
        self.stats['fortigate_events'] += 1
        self.stats['last_detection'] = datetime.now().strftime("%H:%M:%S")
        
        detection_key = f"vpn:{vpn_event_type}:{mode}:{url}"
        if not self._is_duplicate_detection(detection_key):
             if vpn_event_type == 'VPN_CREATING':
                # self.show_notification("🔐 Creating VPN", "User is creating a VPN tunnel.")
                print(f"🔔 Suppressing VPN_CREATING notification (Rule-based)")
             elif vpn_event_type == 'VPN_EDITING':
                # self.show_notification("✏️ Editing VPN", "User is modifying a VPN tunnel.")
                print(f"🔔 Suppressing VPN_EDITING notification (Rule-based)")
             elif vpn_event_type == 'VPN_CREATED':
                self.show_notification("✅ VPN Created", "VPN tunnel saved successfully!")
                print(f"✅ VPN_CREATED notification sent")
             elif vpn_event_type == 'VPN_EDITED':
                self.show_notification("✅ VPN Updated", "VPN tunnel changes saved successfully!")
                print(f"✅ VPN_EDITED notification sent")
        else:
            print(f"   🔄 DUPLICATE: Skipping notification")

    def _handle_ml_prediction_event(self, data):
        """Handle ML prediction result events (Streaming only)"""
        is_streaming = data.get('isStreaming', False)
        
        # User explicitly requested ONLY pre-save notifications
        if not is_streaming:
            print(f"🔮 ML Prediction: Suppressing post-save result")
            return

        ml_data = data.get('data', {})
        label = ml_data.get('label', 'unknown')
        confidence = ml_data.get('confidence', 0)
        
        print(f"🔮 ML Streaming Prediction: {label} ({confidence:.2%})")
        
        # Only show notification if confidence is reasonable (>40% for streaming)
        if confidence > 0.4:
            # DEDUPLICATION
            detection_key = f"ML_STREAM:{label}"
            self.duplicate_window = 10 # 10 seconds debounce for SAME prediction state
            
            if self._is_duplicate_detection(detection_key):
                print(f"   🔄 ML: {label} (Suppressed duplicate)")
                return

            conf_str = f"{(confidence * 100):.1f}%"
            
            # Form friendly display string
            parts = label.split(' ')
            if len(parts) >= 2:
                obj_name = parts[0].replace('_', ' ')
                op_name = parts[1] # CREATE or EDIT
                
                suffix = "ING"
                if op_name.endswith('E'):
                    base_op = op_name[:-1]
                else:
                    base_op = op_name
                
                title = f"🔮 ML: {base_op}{suffix} {obj_name}" # CREATING POLICY
            else:
                title = f"🔮 ML PREDICTION: {label.replace('_', ' ').upper()}"
                
            self.show_notification(
                title,
                f"Confidence: {conf_str}\nSystem is analyzing your pre-save changes..."
            )
            print(f"🚨 ML PRE-SAVE notification sent: {title} ({conf_str})")
        else:
            print(f"⚠️ ML Prediction confidence too low ({confidence:.2%}) - skipping notification")
    # Old detailed window function removed - details now shown in Stats window

    def process_browser_data(self, data):
        """Process data from browser extension"""
        self.stats['total_events'] += 1
        
        event_type = data.get('type', 'unknown')
        print(f"📥 Event #{self.stats['total_events']}: {event_type}")
    
               # Handle admin user creation/edit events (NEW)
        if event_type == 'ADMIN_USER_CHANGE':
            # Get event details
            event_data = data.get('data', {})
            admin_event_type = data.get('eventType', 'UNKNOWN')
            username = event_data.get('username', 'Unknown')
            
            print(f"👤 Admin User Event: {admin_event_type}")
            
            # Show appropriate notification
            # Show appropriate notification
            if admin_event_type == 'ADMIN_USER_CREATING':
                # self.show_notification("👤 Creating Admin User", "User is creating a new admin user...")
                print(f"🔔 Suppressing ADMIN_USER_CREATING notification (Rule-based)")
            elif admin_event_type == 'ADMIN_USER_EDITING':
                # self.show_notification("👤 Editing Admin User", f"User is editing admin user: {username}")
                print(f"🔔 Suppressing ADMIN_USER_EDITING notification (Rule-based)")
            elif admin_event_type == 'ADMIN_USER_CREATED':
                # self.show_notification("✅ Admin User Created!", "Admin user created successfully!")
                print(f"🔔 Suppressing ADMIN_USER_CREATED notification (Rule-based)")
            elif admin_event_type == 'ADMIN_USER_UPDATED':
                # self.show_notification("✅ Admin User Updated!", "Admin user updated successfully!")
                print(f"🔔 Suppressing ADMIN_USER_UPDATED notification (Rule-based)")
            
            return  
        # Handle live policy editing status (NEW)
        if event_type == 'POLICY_LIVE_STATUS':
            self._handle_policy_live_status(data)
            return
        
        # Handle policy creation/edit events (NEW)
        if event_type == 'POLICY_CHANGE':
            self._handle_policy_change_event(data)
            return
        
        # Handle DoS Policy change events (NEW)
        if event_type == 'DOS_POLICY_CHANGE':
            self._handle_dos_policy_change_event(data)
            return
        
        
        # Handle DoS Policy change events (NEW)
        if event_type == 'DOS_POLICY_CHANGE':
            self._handle_dos_policy_change_event(data)
            return
        
        
        # Handle network interface creation/edit events (NEW)
        if event_type == 'INTERFACE_CHANGE':
            self._handle_interface_change_event(data)
            return
        
        # Handle firewall address creation/edit events (NEW)
        if event_type == 'ADDRESS_CHANGE':
            self._handle_address_change_event(data)
            return
         # Handle Central SNAT Map creation/edit events (NEW)
        if event_type == 'CENTRAL_SNAT_CHANGE':
            self._handle_central_snat_change_event(data)
            return
        
        # Handle Firewall Service creation/edit events (NEW)
        if event_type == 'FIREWALL_SERVICE_CHANGE':
            self._handle_firewall_service_change_event(data)
            return
        
        # Handle real-time password change events
        if event_type == 'PASSWORD_CHANGE':
            self._handle_password_change_event(data)
            return
              
        if event_type == 'VPN_CHANGE':
            self._handle_vpn_change_event(data)
            return

        # Handle ML Prediction Result (NEW)
        if event_type == 'ML_PREDICTION_RESULT':
            self._handle_ml_prediction_event(data)
            return
            
        # Debug: Show what URL we're analyzing
        url = self.classifier._extract_url(data)
        title = self.classifier._extract_page_title(data)
        print(f"   🔍 Analyzing URL: {url[:80]}...")
        print(f"   📄 Page Title: {title}")
        
        # Explain event type
        if event_type == 'API_CALL':
            print(f"   📡 API Request: Backend communication")
        elif event_type == 'API_RESPONSE':
            print(f"   📡 API Response: Backend response")
        elif event_type == 'UI_CHANGE':
            print(f"   🖥️  UI Change: Page load/DOM update")
        
    
    def start_server(self):
        """Start HTTP server in background thread"""
        def handler(*args, **kwargs):
            return TrayHandler(*args, tray_app=self, **kwargs)
        
        self.server = HTTPServer(('localhost', 8080), handler)
        print("🚀 HTTP server running on http://localhost:8080")
        print("✅ Ready to receive data from browser extension")
        
        try:
            self.server.serve_forever()
        except Exception as e:
            print(f"Server error: {e}")
    
    def show_stats(self, icon, item):
        """Show statistics and policy history window"""
        root = tk.Tk()
        root.title("FortiGate Monitor - Stats & History")
        root.geometry("600x500")
        root.configure(bg='#f5f5f5')
        
        # Stats section
        stats_frame = tk.Frame(root, bg='#e3f2fd', relief='raised', bd=2)
        stats_frame.pack(fill='x', padx=10, pady=10)
        
        stats_text = f"""📊 Statistics:
Total Events: {self.stats['total_events']}
FortiGate Events: {self.stats['fortigate_events']}
Last Detection: {self.stats['last_detection'] or 'None'}
Server Status: {'Running' if self.running else 'Stopped'}"""
        
        tk.Label(
            stats_frame,
            text=stats_text,
            justify='left',
            bg='#e3f2fd',
            font=('Arial', 10),
            padx=15,
            pady=10
        ).pack()
        
        # Latest policy change section (no history)
        change_frame = tk.Frame(root, bg='#f5f5f5')
        change_frame.pack(fill='both', expand=True, padx=10, pady=(0, 10))
        
        tk.Label(
            change_frame,
            text="📋 Latest Policy Change:",
            font=('Arial', 11, 'bold'),
            bg='#f5f5f5'
        ).pack(anchor='w', pady=(0, 5))
        
        # Show only the latest change
        if hasattr(self, 'latest_policy_change') and self.latest_policy_change:
            item = self.latest_policy_change
            
            # Container frame
            container = tk.Frame(change_frame, bg='white', relief='solid', bd=1)
            container.pack(fill='both', expand=True, padx=5, pady=5)
            
            # Header
            icon = '✏️' if item['mode'] == 'edit' else '🆕'
            mode_text = 'Policy Edited' if item['mode'] == 'edit' else 'Policy Created'
            header_color = '#fff9e6' if item['mode'] == 'edit' else '#e3f2fd'
            
            header_frame = tk.Frame(container, bg=header_color)
            header_frame.pack(fill='x')
            
            tk.Label(
                header_frame,
                text=f"{icon} {mode_text} - {item['timestamp']} - {item['field_count']} fields",
                bg=header_color,
                font=('Arial', 10, 'bold'),
                anchor='w',
                padx=10,
                pady=8
            ).pack(fill='x')
            
            # Details
            details_frame = tk.Frame(container, bg='white')
            details_frame.pack(fill='both', expand=True, padx=10, pady=10)
            
            tk.Label(
                details_frame,
                text=f"🔗 URL: {item['url'][:60]}...",
                bg='white',
                font=('Arial', 8),
                anchor='w',
                fg='#666'
            ).pack(anchor='w', pady=(0, 5))
            
            tk.Label(
                details_frame,
                text="📝 Modified Fields:",
                bg='white',
                font=('Arial', 9, 'bold'),
                anchor='w'
            ).pack(anchor='w', pady=(5, 2))
            
            # Field list
            field_text = tk.Text(
                details_frame,
                height=min(len(item['fields']), 10),
                width=60,
                font=('Consolas', 8),
                bg='#f9f9f9',
                relief='flat',
                wrap='word'
            )
            field_text.pack(fill='both', expand=True, pady=2)
            
            for i, field in enumerate(item['fields'], 1):
                field_text.insert('end', f"  {i}. {field}\n")
            
            field_text.config(state='disabled')
        else:
            tk.Label(
                change_frame,
                text="No policy changes recorded yet",
                bg='white',
                fg='#999',
                pady=20,
                relief='solid',
                bd=1
            ).pack(fill='both', expand=True, padx=5, pady=5)
        
        # Close button
        tk.Button(
            root,
            text="Close",
            command=root.destroy,
            bg='#2196f3',
            fg='white',
            font=('Arial', 10, 'bold'),
            padx=20,
            pady=5,
            cursor='hand2',
            relief='flat'
        ).pack(pady=10)
        
        root.mainloop()
    

    def quit_app(self, icon, item):
        """Quit the application"""
        self.running = False
        if self.server:
            self.server.shutdown()
        if self.icon:
            self.icon.stop()
        sys.exit(0)
    
    def run(self):
        """Run the tray application"""
        self.running = True
        
        # Start HTTP server in background thread
        server_thread = threading.Thread(target=self.start_server, daemon=True)
        server_thread.start()
        
        # Create system tray icon
        image = self.create_icon_image()
        menu = pystray.Menu(
            pystray.MenuItem("Show Stats", self.show_stats),
            pystray.MenuItem("Quit", self.quit_app)
        )
        
        self.icon = pystray.Icon("FortiGate Monitor", image, menu=menu)
        
        print("✅ Tray app started. Check system tray for icon.")
        print("💡 Install browser extension and browse any website to see detections.")
        
        # Run the tray icon (this blocks)
        self.icon.run()

if __name__ == "__main__":
    app = TrayApp()
    app.run()