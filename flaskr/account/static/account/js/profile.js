function deleteAccount() {
    if (confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
        fetch('/account/settings', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                alert("Your account has been deleted successfully.");
                window.location.href = data.redirect_url || '/';
            } else {
                alert("Failed to delete account: " + data.message);
            }
        })
        .catch(error => {
            console.error("Error deleting account:", error);
            alert("An error occurred while trying to delete your account.");
        });
    }
}