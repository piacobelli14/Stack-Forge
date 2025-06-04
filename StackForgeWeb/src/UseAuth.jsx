import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const useAuth = () => {
    const navigate = useNavigate();
    const [token, setTokenState] = useState(null);
    const [userID, setUserID] = useState(null);
    const [organizationID, setOrganizationID] = useState(null); 
    const [isAdmin, setIsAdmin] = useState(false);  
    const [loading, setLoading] = useState(true);

    const isTokenExpired = (token) => {
        if (!token) return true;
        const decodedToken = JSON.parse(atob(token.split('.')[1]));
        const currentTime = Date.now() / 1000;
        return decodedToken.exp < currentTime;
    };

    const decodeToken = (token) => {
        const decodedToken = JSON.parse(atob(token.split('.')[1]));
        return {
            userID: decodedToken.userid,
            organizationID: decodedToken.orgid,
            isAdmin: decodedToken.isadmin
        };
    };

    const setToken = (newToken) => {
        if (newToken) {
            const { userID, organizationID, isAdmin } = decodeToken(newToken);
            setTokenState(newToken);
            setUserID(userID);
            setOrganizationID(organizationID);
            setIsAdmin(isAdmin);
            
            localStorage.setItem('token', newToken);
            localStorage.setItem('userid', userID);
            localStorage.setItem('orgid', organizationID);
            localStorage.setItem('isadmin', isAdmin);
        } else {
            setTokenState(null);
            setUserID(null);
            setOrganizationID(null);
            setIsAdmin(false);  

            localStorage.removeItem('token');
            localStorage.removeItem('userid');
            localStorage.removeItem('orgid');
            localStorage.removeItem('isadmin');
        }
    };

    useEffect(() => {
        const checkTokenExpiration = () => {
            const storedToken = localStorage.getItem('token');

            if (storedToken) {
                if (isTokenExpired(storedToken)) {
                    setToken(null);
                    navigate("/login");
                } else {
                    setToken(storedToken);
                }
            }
            setLoading(false);
        };

        checkTokenExpiration();
        
        const intervalID = setInterval(checkTokenExpiration, 300000); 

        return () => clearInterval(intervalID);
    }, [navigate]);

    const updateOrganizationID = (newOrgID) => {
        setOrganizationID(newOrgID);
        localStorage.setItem('orgid', newOrgID);
    };

    return { 
        token, 
        setToken, 
        userID, 
        setUserID, 
        organizationID, 
        setOrganizationID: updateOrganizationID, 
        isAdmin,  
        loading 
    };
};

export default useAuth;
