// Configuração do Firebase — Painel da Roleta PAD Saúde+
// Projeto: roleta-d372c
const firebaseConfig = {
  apiKey: "AIzaSyAwTRWdRi0X-O85bEM1r9d_jQPm6IWAs2k",
  authDomain: "roleta-d372c.firebaseapp.com",
  databaseURL: "https://roleta-d372c-default-rtdb.firebaseio.com",
  projectId: "roleta-d372c",
  storageBucket: "roleta-d372c.firebasestorage.app",
  messagingSenderId: "547280299466",
  appId: "1:547280299466:web:72c3ed77e1fcb073799b33",
  measurementId: "G-XX03T7JQVD"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const rtdb = firebase.database();
