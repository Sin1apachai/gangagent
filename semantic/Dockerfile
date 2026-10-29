FROM python:3.12-slim
WORKDIR /service
RUN pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir sentence-transformers==3.4.1 transformers==4.49.0
ENV HF_HOME=/models HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false
RUN python -c "from sentence_transformers import SentenceTransformer; m=SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',model_kwargs={'use_safetensors':True}); m.save('/models/office-embedding')"
RUN chmod -R a+rX /models/office-embedding
COPY service.py /service/service.py
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
USER 65534:65534
CMD ["python","service.py"]
