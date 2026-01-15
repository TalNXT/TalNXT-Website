document.addEventListener('DOMContentLoaded', function() {
    const yearElement = document.getElementById("year");
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
});

// Contact Form Handler
function handleFormSubmit(event) {
    event.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');
    const submitText = document.getElementById('submitText');
    const submitSpinner = document.getElementById('submitSpinner');
    const formMessage = document.getElementById('formMessage');
    
    // Get form data
    const formData = {
        name: document.getElementById('name').value.trim(),
        company: document.getElementById('company').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim() || 'Not provided',
        roles: document.getElementById('roles').value.trim(),
        timeline: document.getElementById('timeline').value.trim() || 'Not provided'
    };
    
    // Validate required fields
    if (!formData.name || !formData.company || !formData.email || !formData.roles) {
        formMessage.textContent = 'Please fill in all required fields.';
        formMessage.className = 'mt-2 text-center text-danger';
        formMessage.style.fontSize = '0.8rem';
        return;
    }
    
    // Show loading state
    submitBtn.disabled = true;
    submitText.textContent = 'Sending...';
    submitSpinner.classList.remove('d-none');
    formMessage.textContent = '';
    formMessage.className = 'mt-2 text-center';
    formMessage.style.fontSize = '0.8rem';
    
    // Create email content with proper formatting
    const subject = `New Hiring Requirement from ${formData.name} - ${formData.company}`;
    const body = `New Hiring Requirement Submitted

Name: ${formData.name}
Company: ${formData.company}
Email: ${formData.email}
Phone: ${formData.phone}
Roles to Hire: ${formData.roles}
Timeline/Requirements:
${formData.timeline}

---
This email was sent from the TalNXT website contact form.`;
    
    // Create mailto link with proper encoding
    const mailtoLink = `mailto:recruiter@talnxt.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    // Try to open email client
    try {
        // Create a temporary anchor element for better compatibility
        const mailLink = document.createElement('a');
        mailLink.href = mailtoLink;
        mailLink.style.display = 'none';
        document.body.appendChild(mailLink);
        mailLink.click();
        document.body.removeChild(mailLink);
        
        // Reset form immediately
        document.getElementById('contactForm').reset();
        
        // Show success message
        setTimeout(() => {
            submitBtn.disabled = false;
            submitText.textContent = 'Submit Requirement';
            submitSpinner.classList.add('d-none');
            formMessage.innerHTML = '✓ Thank you! Your email client should open. If it didn\'t, please email us directly at <a href="mailto:recruiter@talnxt.com" style="color: var(--primary); text-decoration: underline;">recruiter@talnxt.com</a>';
            formMessage.className = 'mt-2 text-center text-success';
            formMessage.style.fontSize = '0.8rem';
        }, 500);
    } catch (error) {
        // Fallback: show email details for manual copy
        submitBtn.disabled = false;
        submitText.textContent = 'Submit Requirement';
        submitSpinner.classList.add('d-none');
        formMessage.innerHTML = `Email client not available. Please send an email to <strong>recruiter@talnxt.com</strong> with the following details:<br><br>
        <div style="text-align: left; background: #f8fafc; padding: 0.75rem; border-radius: 0.5rem; font-size: 0.75rem; margin-top: 0.5rem;">
        <strong>Subject:</strong> ${subject}<br><br>
        <strong>Message:</strong><br>${body.replace(/\n/g, '<br>')}
        </div>`;
        formMessage.className = 'mt-2 text-center';
        formMessage.style.fontSize = '0.8rem';
    }
}
