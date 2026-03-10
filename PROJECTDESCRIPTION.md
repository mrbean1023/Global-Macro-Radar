Global Macro Radar AI is a fully deployed, AI-powered macroeconomic intelligence platform that eliminates the information overload problem faced by asset managers — where critical market signals are fragmented across dozens of platforms, monitored manually, and frequently missed until it is too late.

The platform continuously ingests news from 15+ live data sources, applies AI to extract meaning from every article, and scores macro themes by velocity, volume, and sentiment in real time — all without any manual intervention. A 16-job background scheduler keeps every data layer fresh around the clock.

To solve this problem statement, theme evolution is tracked through 8-day sparkline trends and full timestamped article history in PostgreSQL. Hot and cooling detection runs on a proprietary Velocity x Volume x Sentiment scoring engine recalculated every 20 minutes, with automated alerts firing within 15 minutes of any threshold breach. Cross-asset connections are surfaced through a real Pearson-r correlation network built from live price data, alongside integrated yield curves, central bank sppech tone analysis, commodity futures, and curves, central bank speech tone analysis, commodity futures, and CFTC hedge fund positioning. Institutional memory is preserved through a FAISS semantic vector store powering a RAG-based Analyst AI that answers any macro question with full source drawn from the actual article database. For the bonus requirement, a Chain Reaction Simulator maps any macro event to its full downstream causal chain — directly matching the brief's own example of an inflation print cascading through Fed policy to rates volatility. 

This is not a prototype. Every feature is live and operational right now. 
https://global-macro-radar-production.up.railway.app/

Stack: FastAPI, PostgreSQL, FAISS, React, Claude AI, Railway, 15+ Live APIs
